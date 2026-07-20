# lark-copilot-bridge

把飞书消息桥接到本地 GitHub Copilot CLI 的轻量机器人。**扫码即用**——首次运行终端显示二维码，飞书扫码自动创建应用，零手动配置。回复用**流式卡片**实时更新。

照着 [`zarazhangrui/lark-coding-agent-bridge`](https://github.com/zarazhangrui/lark-coding-agent-bridge)（桥接 Claude Code / Codex）的实现方式从零手写，改为桥接 GitHub Copilot CLI。

> 学习笔记见 [LEARNINGS.md](./LEARNINGS.md)，记录了对原项目源码的逐模块分析和本项目的实现对照。

## 体验：一条命令上线

```bash
npm start
```

```
检查 copilot CLI...
✓ copilot CLI 已就绪
未检测到飞书应用配置，进入扫码创建向导。

请用飞书 App 扫描以下二维码完成应用创建：

  ▄▄▄▄▄▄▄ ▄▄▄▄ ▄▄▄▄▄▄▄
  █ ▄▄▄ █ ▀▀▀  █ ▄▄▄ █
  ...

二维码有效期：约 5 分钟
也可以直接在浏览器打开：https://...

✓ 应用创建成功
  App ID:  cli_xxxxxxxxxxxxxxxx
  Creator: ou_xxx (应用 owner，自动豁免访问控制)

═══════════════════════════════════════════════════
  🤖 机器人已上线！在飞书里发消息即可。
═══════════════════════════════════════════════════
```

在飞书里搜到机器人，私聊或群聊 @它即可。回复用流式卡片实时显示 Copilot 的输出过程。

## 架构（对照原项目）

```
飞书用户 ←(WebSocket)→ 飞书平台 ←(createLarkChannel)→ 本桥接 ←(spawn)→ copilot CLI
```

| 组件 | 原项目 | 本项目 |
|------|--------|--------|
| 飞书 SDK | `@larksuite/channel` | `@larksuite/channel`（同款） |
| 扫码建应用 | `registerApp()` + `qrcode-terminal` | 同款 |
| WS 连接 | `createLarkChannel()` | 同款 |
| 流式卡片 | `channel.stream({card:{initial,producer}})` + RunState reducer | 同款（简化状态：thinking→streaming→final） |
| 代理适配 | ClaudeAdapter（`--output-format stream-json`） | CopilotAdapter（stdout 流式 onChunk） |
| 会话连续 | `claude --resume <sessionId>` | 自维护历史拼 prompt（copilot 无 --resume） |

## 前置条件

1. **Node.js >= 20.12.0**
2. **GitHub Copilot CLI**（需 Copilot 订阅）：
   ```bash
   curl -fsSL https://gh.io/copilot-install | bash
   copilot   # 首次运行 /login 登录 GitHub
   ```

> 不需要 lark-cli，也不需要手动在飞书开放平台建应用。`@larksuite/channel` 的 `registerApp()` 会通过扫码自动创建。

## 安装

```bash
cd lark-copilot-bridge
npm install
cp .env.example .env   # 可选：设置 COPILOT_CWD 等
```

## 运行

```bash
npm start
```

首次运行终端扫码绑定飞书应用，凭证存到 `~/.lark-copilot-bridge/config.json`，下次免扫码。机器人上线后在飞书里发消息：

- **私聊**：直接发消息
- **群聊**：需要 @ 机器人
- **命令**：`/new`（清会话）`/stop`（中断）`/status`（状态）`/help`（帮助）

## 工作原理

| 步骤 | 实现 | 对照原项目 |
|------|------|-----------|
| 扫码建应用 | `registerApp({ onQRCodeReady })` 终端二维码 | wizard.ts `runRegistrationWizard` |
| 凭证持久化 | `~/.lark-copilot-bridge/config.json` (mode 0600) | ~/.lark-channel/config.json |
| WS 连接 | `createLarkChannel({ appId, appSecret, ... })` | channel.ts |
| 收消息 | `channel.on({ message })` → NormalizedMessage | 同款 |
| 流式回复 | `channel.stream({card:{initial,producer}})` + `ctrl.update()` | 同款 |
| copilot 调用 | `spawn copilot -p "..." -s --no-ask-user`，stdout onChunk | ClaudeAdapter（stream-json） |
| 会话管理 | `Map<scope, History[]>` 拼 prompt | SessionStore + `--resume` |
| 队列 | MessageQueue，同 scope 串行 | PendingQueue + block/unblock |

## 项目结构

```
bin/lark-copilot-bridge.ts   # CLI 入口
src/
  index.ts                   # 主入口：检测+扫码+通道+消息流
  config.ts                  # 凭证持久化 + copilot 配置
  logger.ts
  session.ts                 # 会话管理（自维护历史）
  queue.ts                   # 消息队列（同 scope 串行）
  commands.ts                # 斜杠命令
  lark/
    client.ts                # @larksuite/channel 封装：registerApp+createLarkChannel+stream
    card.ts                  # 飞书卡片（thinking/streaming/final/error）
  copilot/
    adapter.ts               # copilot CLI 子进程 + 流式 onChunk
LEARNINGS.md                 # 原项目源码逐模块分析
```

## 开发

```bash
npm run typecheck   # 类型检查
npm run build       # 构建
npm run dev         # tsx 直接跑源码
```

## 许可证

MIT
