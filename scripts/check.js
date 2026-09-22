import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

let count = 0;
for (const dir of ['server', 'public', 'scripts', 'test']) {
  let names;
  try { names = readdirSync(dir, { recursive: true }); } catch { continue; }
  for (const name of names.filter(n => n.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', `${dir}/${name}`], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
    count++;
  }
}
if (!count) process.exit(1);
console.log(`Syntax OK: ${count} JavaScript files`);
