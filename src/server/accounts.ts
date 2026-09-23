import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';

/**
 * Private-alpha allowlist. Accounts are engine metadata: nothing here is ever written into a
 * Person, a mind, knowledge or an event. Tokens are random 32-byte secrets shown once at creation;
 * only a salted scrypt hash is stored. The file lives in the environment's credentials directory,
 * outside any source tree or release directory.
 */
export interface AccountRecord {
  id: string; displayName: string; salt: string; tokenHash: string; enabled: boolean;
  roles: ('player' | 'developer')[]; maxCharacters: number; createdAtIso: string;
}
interface AccountFile { format: 1; accounts: AccountRecord[] }

const ID = /^[a-z][a-z0-9_-]{1,31}$/;
const hash = (token: string, salt: string) => scryptSync(token, Buffer.from(salt, 'hex'), 32).toString('hex');

export class AccountRegistry {
  private file: AccountFile = { format: 1, accounts: [] };
  private loadedMtime = '';
  constructor(readonly path: string) { this.reload(); }
  /** Re-read the allowlist (cheap; called on each connection attempt so disabling takes effect without restart). */
  reload(): void {
    if (!existsSync(this.path)) { this.file = { format: 1, accounts: [] }; return; }
    const raw = readFileSync(this.path, 'utf8');
    if (raw === this.loadedMtime) return;
    const parsed = JSON.parse(raw) as AccountFile;
    if (parsed.format !== 1 || !Array.isArray(parsed.accounts)) throw new Error(`Unrecognised account file ${this.path}`);
    this.file = parsed; this.loadedMtime = raw;
  }
  list(): AccountRecord[] { return this.file.accounts.map(a => ({ ...a })); }
  get(id: string): AccountRecord | undefined { return this.file.accounts.find(a => a.id === id); }
  /** Constant-time verification. Unknown ids still pay the scrypt cost so timing does not reveal them. */
  authenticate(id: unknown, token: unknown): AccountRecord | null {
    this.reload();
    const account = typeof id === 'string' ? this.get(id) : undefined;
    const secret = typeof token === 'string' && token.length >= 16 && token.length <= 256 ? token : 'x'.repeat(43);
    const expected = Buffer.from(account?.tokenHash ?? '0'.repeat(64), 'hex');
    const actual = Buffer.from(hash(secret, account?.salt ?? '00'.repeat(16)), 'hex');
    const ok = timingSafeEqual(expected, actual);
    return ok && account && account.enabled ? account : null;
  }
  private write(): void {
    const data = JSON.stringify(this.file, null, 2), tmp = this.path + '.tmp';
    const fd = openSync(tmp, 'w'); try { writeSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, this.path); this.loadedMtime = data;
  }
  /** Create an account; returns the one-time plaintext token. */
  add(id: string, displayName: string, roles: AccountRecord['roles'] = ['player'], maxCharacters = 3): string {
    if (!ID.test(id)) throw new Error('Account id must be 2–32 chars of a-z, 0-9, _ or -, starting with a letter');
    if (this.get(id)) throw new Error(`Account ${id} already exists`);
    const token = randomBytes(32).toString('base64url'), salt = randomBytes(16).toString('hex');
    this.file.accounts.push({ id, displayName: displayName.slice(0, 40), salt, tokenHash: hash(token, salt), enabled: true, roles, maxCharacters, createdAtIso: new Date().toISOString() });
    this.write(); return token;
  }
  /** Replace a token (e.g. leaked); returns the new one-time plaintext token. */
  rotate(id: string): string {
    const a = this.get(id); if (!a) throw new Error(`No account ${id}`);
    const token = randomBytes(32).toString('base64url'); a.salt = randomBytes(16).toString('hex'); a.tokenHash = hash(token, a.salt);
    this.write(); return token;
  }
  setEnabled(id: string, enabled: boolean): void { const a = this.get(id); if (!a) throw new Error(`No account ${id}`); a.enabled = enabled; this.write(); }
}
