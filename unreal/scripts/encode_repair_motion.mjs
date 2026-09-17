// Preserve recorded wall-clock intervals. This does not interpolate missing motion.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const input = path.resolve(process.argv[2]);
const data = JSON.parse(fs.readFileSync(input, 'utf8'));
const frames = data.frames.map(f => {
  const actual = f.path.replace(/\.png$/, '00000.png');
  if (!fs.existsSync(actual)) throw new Error(`Missing recorded frame ${actual}`);
  return {...f, path:actual.replaceAll('\\','/')};
});
if (frames.length < 2) throw new Error('Insufficient video frames');
const concat = frames.flatMap((f,i) => [
  `file '${f.path.replaceAll("'", "'\\''")}'`,
  `duration ${Math.max(.001,(frames[i+1]?.seconds ?? data.seconds)-f.seconds)}`,
]).concat(`file '${frames.at(-1).path}'`).join('\n');
const manifest=path.join(path.dirname(frames[0].path),'recording.ffconcat');
fs.writeFileSync(manifest,concat);
const output=input.replace(/\.json$/,'.mp4');
const result=spawnSync('ffmpeg',['-y','-f','concat','-safe','0','-i',manifest,
  '-vf','scale=1280:-2','-fps_mode','vfr','-c:v','libx264','-crf','24','-pix_fmt','yuv420p','-movflags','+faststart',output],{encoding:'utf8'});
if(result.status!==0)throw new Error(result.stderr);
console.log(JSON.stringify({output,frames:frames.length,seconds:data.seconds,
  captureLimit:data.captureLimit,notSmoothnessProof:true}));
