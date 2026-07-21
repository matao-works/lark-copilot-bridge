#!/usr/bin/env node
/**
 * CLI 入口
 */
import { main } from '../src/index.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`lark-copilot-bridge — 在飞书里和本地 GitHub Copilot CLI 对话

用法：
  lark-copilot-bridge            启动桥接（扫码即用，凭证存 ~/.lark-copilot-bridge/）
  lark-copilot-bridge --help     显示本帮助

安装（无需 clone 仓库）：
  npx lark-copilot-bridge
  npm install -g lark-copilot-bridge

配置：
  ~/.lark-copilot-bridge/.env    可选环境变量（见 README）
  ~/.lark-copilot-bridge/config.json   扫码凭证与 ACL（自动生成）

前置：
  Node.js >= 20
  本机已安装并登录 GitHub Copilot CLI

飞书内命令：
  /new /stop /status /help /timeout /cd /ws /invite /remove
  详见 README.md
`);
  process.exit(0);
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
