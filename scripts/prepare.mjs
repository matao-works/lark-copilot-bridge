/**
 * git/npm 全局安装时 prepare 环境里经常没有可用的 tsup PATH。
 * 仓库提交 dist/ 后，安装直接跳过构建；本地开发有 tsup 时再 build。
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distJs = join(root, 'dist', 'lark-copilot-bridge.js');

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (existsSync(distJs)) {
  console.log('prepare: 使用已有 dist/，跳过构建');
  process.exit(0);
}

let tsupCli;
try {
  tsupCli = require.resolve('tsup/dist/cli-default.js');
} catch {
  tsupCli = null;
}

if (tsupCli) {
  console.log('prepare: 本地构建 dist/…');
  run(process.execPath, [tsupCli]);
  process.exit(0);
}

console.error('prepare: 缺少 dist/ 且未安装 tsup。');
console.error('  请在仓库根目录执行: npm install && npm run build');
process.exit(1);
