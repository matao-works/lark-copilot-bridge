/**
 * git/npm 安装时 prepare 常在本机还没有 tsup 时触发。
 * - 有 tsup：正常 build
 * - 无 tsup 但已有 dist：跳过（适合已提交产物或二次安装）
 * - 都没有：用 npx 拉 tsup 再 build
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const distJs = new URL('../dist/lark-copilot-bridge.js', import.meta.url);

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

let hasTsup = false;
try {
  require.resolve('tsup');
  hasTsup = true;
} catch {
  hasTsup = false;
}

if (hasTsup) {
  run('npm', ['run', 'build']);
} else if (existsSync(distJs)) {
  console.log('prepare: tsup 不可用，使用已有 dist/');
} else {
  console.log('prepare: 通过 npx 安装 tsup 并构建…');
  run('npx', ['--yes', 'tsup']);
}
