/**
 * Real-input footage without Playwright's video recorder: Chrome's own CDP screencast saves JPEG frames with their
 * timestamps, and the system ffmpeg (FFMPEG env, else the Chocolatey path, else `ffmpeg` on PATH) encodes them at
 * their real timing. Nothing is downloaded or installed.
 */
import type { Page } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export async function startScreencast(page: Page, dir: string, opts: { quality?: number; everyNthFrame?: number } = {}) {
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames: { file: string; t: number }[] = [];
  cdp.on('Page.screencastFrame', async f => {
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, file), Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: opts.quality ?? 80, everyNthFrame: opts.everyNthFrame ?? 1 });
  return {
    frames,
    /** Stop capturing and encode an MP4 with each frame held for its real duration; returns the file or null. */
    async stop(mp4: string): Promise<string | null> {
      await cdp.send('Page.stopScreencast').catch(() => undefined); await cdp.detach().catch(() => undefined);
      if (frames.length < 2) return null;
      const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(.001, (frames[i + 1]?.t ?? f.t + .033) - f.t).toFixed(4)}`).join('\n') + `\nfile '${frames[frames.length - 1].file}'\n`;
      writeFileSync(join(dir, 'frames.txt'), list);
      const ff = process.env.FFMPEG ?? (existsSync('C:/ProgramData/chocolatey/bin/ffmpeg.exe') ? 'C:/ProgramData/chocolatey/bin/ffmpeg.exe' : 'ffmpeg');
      const r = spawnSync(ff, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'frames.txt', '-vf', 'fps=30,format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-crf', '22', mp4], { cwd: dir });
      return r.status === 0 ? join(dir, mp4) : null;
    },
  };
}
