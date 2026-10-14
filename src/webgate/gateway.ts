import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import { ALPHA_PROTOCOL, CLIENT_KINDS, H, parseCharacterRequest } from '../server/protocol';

/**
 * The browser gateway: the smallest admission adapter that lets a web page play through the
 * existing authoritative server.
 *
 * A browser cannot set the custom upgrade headers the server requires (that is intentional: it
 * keeps arbitrary web pages from driving a character). So this process, bound to loopback, holds the
 * account credential server-side, authenticates the *browser session* itself, and then opens one
 * upstream socket per browser socket with the native headers and client kind `web`.
 *
 * What it does not do: it does not step or hold a World, does not interpret gameplay, does not
 * expose any admin or debug endpoint of the server, and does not forward to any destination other
 * than the one upstream it was configured with. The account token never leaves this process: it is
 * not in a URL, a cookie, a page, a bundle, a log line or any message sent to the browser.
 */
export interface GatewayCredentials { account: string; token: string }
export interface GatewayOptions {
  /** Interface to listen on. Only loopback addresses are accepted. */
  host?: string;
  /** 0 picks a free port (tests). */
  port: number;
  upstream: { host: string; port: number };
  /** Exact `host:port` destinations the gateway may ever connect to. Defaults to `upstream` only. */
  upstreamAllow?: string[];
  credentials: GatewayCredentials;
  /** Directory of the built client. Omit to serve API and WebSocket only. */
  staticDir?: string;
  /** Extra exact origins allowed to open a socket (e.g. a Vite dev origin). The gateway's own origin is always allowed. */
  extraOrigins?: string[];
  launchTtlMs?: number;
  sessionTtlMs?: number;
  /** Message rate ceiling per browser socket (messages per second, one-second window). */
  maxMessagesPerSecond?: number;
  log?: (level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) => void;
}

/** What a browser may send. Everything else is dropped and counted; `debug_inspect` and the
 * legacy unbound `move`/`attack` forms are deliberately absent. */
export const BROWSER_MESSAGE_TYPES = new Set([
  'command', 'presentation_ack', 'clock_probe', 'save',
  'person_action', 'talk', 'dialogue_text', 'dialogue_option', 'dialogue_close', 'interact', 'container_transfer', 'hush',
]);
/** The server's own maxPayload is 4096; matching it means a message the gateway lets through can be read. */
export const MAX_BROWSER_MESSAGE_BYTES = 4096;
const MAX_BROWSER_BUFFER_BYTES = 2 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const COOKIE = 'tvw_session';
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

interface Session { id: string; createdAt: number; expiresAt: number; sockets: Set<WebSocket>; launched: boolean }

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
const token = (bytes = 32) => randomBytes(bytes).toString('base64url');

export class WebGateway {
  private readonly http: Server;
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BROWSER_MESSAGE_BYTES });
  private readonly sessions = new Map<string, Session>();
  private readonly launches = new Map<string, number>();
  private readonly allowedUpstreams: Set<string>;
  private readonly adminToken = token(32);
  private readonly log: NonNullable<GatewayOptions['log']>;
  private origin = '';
  private boundPort = 0;
  readonly counters = { sockets: 0, upstreamRefused: 0, droppedMessages: 0, oversized: 0, rateClosed: 0, rejectedUpgrades: 0, launches: 0 };

  constructor(private readonly options: GatewayOptions) {
    const host = options.host ?? '127.0.0.1';
    if (!LOOPBACK_HOSTS.has(host)) throw new Error(`The web gateway binds loopback only (got ${host}); nonlocal access needs an explicit secure transport that this release does not provide.`);
    this.log = options.log ?? (() => {});
    this.allowedUpstreams = new Set((options.upstreamAllow ?? [`${options.upstream.host}:${options.upstream.port}`]));
    if (!this.allowedUpstreams.has(`${options.upstream.host}:${options.upstream.port}`)) throw new Error('Configured upstream is not in the upstream allowlist');
    if (!options.credentials.account || !options.credentials.token) throw new Error('Gateway credentials are required');
    this.http = createServer((req, res) => this.handleHttp(req, res));
    this.http.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
  }

  get url(): string { return this.origin; }
  get port(): number { return this.boundPort; }
  /** Local operator secret for minting further launch links. Held in memory; the launcher reads it from the file it was given. */
  get operatorSecret(): string { return this.adminToken; }

  async listen(): Promise<void> {
    const host = this.options.host ?? '127.0.0.1';
    await new Promise<void>((resolve, reject) => { this.http.once('error', reject); this.http.listen(this.options.port, host, () => { this.http.off('error', reject); resolve(); }); });
    const address = this.http.address();
    this.boundPort = typeof address === 'object' && address ? address.port : this.options.port;
    this.origin = `http://${host === '::1' ? '[::1]' : host}:${this.boundPort}`;
    this.log('info', 'gateway_listening', { origin: this.origin, upstream: `${this.options.upstream.host}:${this.options.upstream.port}`, account: this.options.credentials.account });
  }
  async close(): Promise<void> {
    for (const s of this.sessions.values()) for (const ws of s.sockets) try { ws.close(1001, 'Gateway stopping'); } catch { /* closing */ }
    this.wss.close();
    await new Promise<void>(r => this.http.close(() => r()));
  }

  /** A one-time link that starts a browser session. Valid for `launchTtlMs`; the nonce is consumed on first use. */
  issueLaunchUrl(): string {
    const nonce = token(24);
    this.launches.set(nonce, Date.now() + (this.options.launchTtlMs ?? 120_000));
    this.counters.launches++;
    return `${this.origin}/launch/${nonce}`;
  }

  private allowedOrigins(): Set<string> {
    const own = new Set([this.origin, this.origin.replace('127.0.0.1', 'localhost')]);
    for (const o of this.options.extraOrigins ?? []) own.add(o);
    return own;
  }
  private cookieSession(req: IncomingMessage): Session | null {
    const header = String(req.headers.cookie ?? '');
    for (const part of header.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k !== COOKIE) continue;
      const s = this.sessions.get(v.join('='));
      if (s && s.expiresAt > Date.now()) return s;
    }
    return null;
  }
  private send(res: ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  }
  private sweep(): void {
    const now = Date.now();
    for (const [n, exp] of this.launches) if (exp < now) this.launches.delete(n);
    for (const [id, s] of this.sessions) if (s.expiresAt < now && s.sockets.size === 0) this.sessions.delete(id);
  }
  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    this.sweep();
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    // Only requests addressed to this gateway's own host are served (blocks DNS-rebinding names).
    const host = String(req.headers.host ?? '');
    if (!this.allowedHosts().has(host)) return this.send(res, 421, { error: 'wrong host' });

    if (path.startsWith('/launch/') && req.method === 'GET') {
      const nonce = path.slice('/launch/'.length);
      const exp = this.launches.get(nonce);
      if (!exp || exp < Date.now()) return this.send(res, 403, { error: 'This launch link was already used or has expired. Start Play Torn Veil Web again.' });
      this.launches.delete(nonce);
      const id = token(32), ttl = this.options.sessionTtlMs ?? 12 * 3600_000;
      this.sessions.set(id, { id, createdAt: Date.now(), expiresAt: Date.now() + ttl, sockets: new Set(), launched: true });
      const view = url.searchParams.get('view');
      const destination = view === 'isometric' || view === 'third-person' ? '/?view=' + view : '/';
      res.writeHead(302, { location: destination, 'set-cookie': `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(ttl / 1000)}`, 'cache-control': 'no-store' });
      return void res.end();
    }
    if (path === '/api/operator/launch' && req.method === 'POST') {
      const given = String(req.headers['x-torn-veil-gateway-operator'] ?? '');
      if (!safeEqual(given, this.adminToken)) return this.send(res, 403, { error: 'forbidden' });
      return this.send(res, 200, { url: this.issueLaunchUrl() });
    }
    if (path === '/api/session') {
      const s = this.cookieSession(req);
      return this.send(res, s ? 200 : 401, s ? { ok: true, account: this.options.credentials.account, protocol: ALPHA_PROTOCOL } : { ok: false, error: 'No session. Open the game from Play Torn Veil Web.' });
    }
    if (path === '/api/upstream-health') {
      if (!this.cookieSession(req)) return this.send(res, 401, { ok: false });
      const { host: h, port } = this.options.upstream;
      fetch(`http://${h}:${port}/health`, { signal: AbortSignal.timeout(3000) })
        .then(async r => this.send(res, 200, { reachable: true, health: await r.json().catch(() => null) }))
        .catch(() => this.send(res, 200, { reachable: false }));
      return;
    }
    if (path.startsWith('/api/')) return this.send(res, 404, { error: 'not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return this.send(res, 405, { error: 'method not allowed' });
    this.serveStatic(req, res, path);
  }
  private allowedHosts(): Set<string> {
    const p = this.boundPort;
    return new Set([`127.0.0.1:${p}`, `localhost:${p}`, `[::1]:${p}`]);
  }
  private serveStatic(req: IncomingMessage, res: ServerResponse, path: string): void {
    const root = this.options.staticDir;
    const headers = {
      'content-security-policy': `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:${this.boundPort} ws://localhost:${this.boundPort} blob: data:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'cross-origin-opener-policy': 'same-origin',
    };
    if (!root) { res.writeHead(404, headers); return void res.end('No client bundled'); }
    let rel = decodeURIComponent(path);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(root, rel));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403, headers); return void res.end('Forbidden'); }
    let target = file;
    try { if (!existsSync(target) || statSync(target).isDirectory()) target = join(root, 'index.html'); } catch { target = join(root, 'index.html'); }
    if (!existsSync(target)) { res.writeHead(404, headers); return void res.end('Client not built. Run npm run web:build.'); }
    const body = readFileSync(target);
    // Only Vite's content-hashed files under /assets/ may be cached for an hour. Models and other unhashed files keep their
    // names when they are rebuilt, and a stale cached kit is worse than re-reading a local file, so they are always revalidated.
    const long = /[\\/]assets[\\/]/.test(target);
    res.writeHead(200, { ...headers, 'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream', 'content-length': String(body.length), 'cache-control': long ? 'public, max-age=3600' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  private reject(socket: Duplex, code: number, why: string): void {
    this.counters.rejectedUpgrades++;
    this.log('warn', 'upgrade_rejected', { code, why });
    socket.write(`HTTP/1.1 ${code} ${code === 401 ? 'Unauthorized' : code === 403 ? 'Forbidden' : code === 421 ? 'Misdirected Request' : 'Bad Request'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }
  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/ws') return this.reject(socket, 400, 'path');
    if (!this.allowedHosts().has(String(req.headers.host ?? ''))) return this.reject(socket, 421, 'host');
    // Cross-site protection: a browser always sends Origin on a WebSocket handshake, and a page on
    // another origin cannot forge it. Exact match only; no wildcards, no missing-origin allowance.
    const origin = String(req.headers.origin ?? '');
    if (!origin || !this.allowedOrigins().has(origin)) return this.reject(socket, 403, 'origin');
    const session = this.cookieSession(req);
    if (!session) return this.reject(socket, 401, 'session');
    const request = parseCharacterRequest(url.searchParams.get('character') ?? 'auto', url.searchParams.get('name'), url.searchParams.get('sex'));
    if (!request) return this.reject(socket, 400, 'character request');
    this.wss.handleUpgrade(req, socket, head, browser => this.bridge(browser, session, url));
  }
  private bridge(browser: WebSocket, session: Session, url: URL): void {
    this.counters.sockets++;
    session.sockets.add(browser);
    const { host, port } = this.options.upstream;
    if (!this.allowedUpstreams.has(`${host}:${port}`)) { this.counters.upstreamRefused++; browser.close(1008, 'Upstream not allowlisted'); return; }
    const headers: Record<string, string> = {
      [H.client]: CLIENT_KINDS.web, [H.protocol]: String(ALPHA_PROTOCOL), [H.region]: '2', [H.interaction]: '2',
      [H.account]: this.options.credentials.account, [H.token]: this.options.credentials.token,
      [H.character]: url.searchParams.get('character') ?? 'auto',
    };
    const name = url.searchParams.get('name'), sex = url.searchParams.get('sex');
    if (name) headers[H.characterName] = name;
    if (sex) headers[H.characterSex] = sex;
    const upstream = new WebSocket(`ws://${host}:${port}`, { headers, maxPayload: 4 * 1024 * 1024 });
    const pending: string[] = [];
    let opened = false, closed = false;
    const shutdown = (code: number, reason: string) => {
      if (closed) return; closed = true; session.sockets.delete(browser);
      const safe = code >= 4000 && code <= 4999 ? code : code === 1000 || code === 1001 || code === 1008 || code === 1011 || code === 1013 ? code : 1011;
      try { if (browser.readyState === WebSocket.OPEN) browser.close(safe, reason.slice(0, 120)); } catch { /* closing */ }
      try { upstream.close(); } catch { /* closing */ }
    };
    upstream.on('open', () => { opened = true; for (const m of pending.splice(0)) upstream.send(m); });
    upstream.on('message', (data, isBinary) => {
      if (browser.readyState !== WebSocket.OPEN) return;
      if (browser.bufferedAmount > MAX_BROWSER_BUFFER_BYTES) return shutdown(1013, 'Browser too slow');
      browser.send(data, { binary: isBinary });
    });
    upstream.on('close', (code, reason) => shutdown(code, reason.toString() || 'Server closed the connection'));
    upstream.on('error', e => { this.log('warn', 'upstream_error', { error: e.message }); shutdown(1011, 'Cannot reach the game server'); });

    const windowMs = 1000, limit = this.options.maxMessagesPerSecond ?? 400;
    let windowStart = Date.now(), inWindow = 0;
    browser.on('message', (data, isBinary) => {
      if (isBinary) { this.counters.droppedMessages++; return; }
      const text = data.toString();
      if (Buffer.byteLength(text) > MAX_BROWSER_MESSAGE_BYTES) { this.counters.oversized++; return shutdown(1009, 'Message too large'); }
      const now = Date.now();
      if (now - windowStart >= windowMs) { windowStart = now; inWindow = 0; }
      if (++inWindow > limit) { this.counters.rateClosed++; return shutdown(1008, 'Rate limit'); }
      let type: unknown;
      try { type = JSON.parse(text)?.type; } catch { this.counters.droppedMessages++; return; }
      if (typeof type !== 'string' || !BROWSER_MESSAGE_TYPES.has(type)) { this.counters.droppedMessages++; return; }
      if (!opened) { if (pending.length < 32) pending.push(text); return; }
      upstream.send(text);
    });
    browser.on('close', () => shutdown(1000, 'Browser closed'));
    browser.on('error', () => shutdown(1011, 'Browser socket error'));
  }
}
