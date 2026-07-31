#!/usr/bin/env node
/**
 * CLI 入口
 */
import { dispatchCli } from '../src/cli.js';
import { main } from '../src/index.js';

const args = process.argv.slice(2);

const code = await dispatchCli(args);
if (code !== null) {
  process.exit(code);
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
