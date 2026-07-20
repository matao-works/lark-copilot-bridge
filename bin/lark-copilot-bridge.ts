#!/usr/bin/env node
/**
 * CLI 入口
 *
 * 用法：
 *   lark-copilot-bridge          启动桥接（从 .env 读配置）
 *   lark-copilot-bridge --help   显示帮助
 *
 * 配置通过 .env 文件（见 .env.example）。MVP 不做复杂参数解析。
 */
import { main } from '../src/index.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`lark-copilot-bridge — 把飞书消息桥接到本地 GitHub Copilot CLI

用法：
  lark-copilot-bridge            启动桥接程序
  lark-copilot-bridge --help     显示本帮助

配置：
  复制 .env.example 为 .env，填入飞书应用凭证和工作目录。
  首次使用需先安装并登录 copilot CLI（见 README.md）。

飞书内命令：
  /new   清空会话    /stop  中断任务    /status  看状态    /help  帮助
`);
  process.exit(0);
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
