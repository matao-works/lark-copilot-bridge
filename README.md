# lark-copilot-bridge

在飞书里和**本机** [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli) 对话。消息走 WebSocket 长连接，回复用流式卡片实时刷新。

适合个人自用：扫码创建飞书应用，凭证本地保存，默认不锁聊天白名单。

## 快速开始

**前置：** Node.js ≥ 20，且本机已安装并登录 Copilot CLI：

```bash
curl -fsSL https://gh.io/copilot-install | bash
copilot   # 首次运行按提示 /login
```

### 方式一：直接运行（推荐）

```bash
npx lark-copilot-bridge
```

### 方式二：全局安装

```bash
npm install -g lark-copilot-bridge
lark-copilot-bridge
```

npm 尚未发布时，可从 GitHub 安装：

```bash
npm install -g github:ma345564280/lark-copilot-bridge
```

或使用安装脚本：

```bash
curl -fsSL https://raw.githubusercontent.com/ma345564280/lark-copilot-bridge/main/scripts/install.sh | bash
```

**无需 clone 仓库，无需在项目目录里 `npm start`。**

### 首次运行

终端出现二维码 → 飞书 App 扫码 → 自动创建应用并保存凭证到 `~/.lark-copilot-bridge/config.json`。

```
✓ copilot CLI 已就绪
请用飞书 App 扫描以下二维码完成应用创建：
...
✓ 应用创建成功

═══════════════════════════════════════════════════
  🤖 机器人已上线！在飞书里发消息即可。
     私聊直接发，群聊需 @机器人
     发 /help 看可用命令
═══════════════════════════════════════════════════
```

在飞书里搜索机器人名称，私聊或群聊 `@` 它即可。

## 飞书里怎么用

| 场景 | 用法 |
|------|------|
| 私聊 | 直接发消息 |
| 群聊 | 需要 @ 机器人 |
| 中断任务 | 点卡片底部 **⏹ 终止**，或发 `/stop` |
| 新话题 | `/new` |

回复以流式卡片挂在你的消息下方，Copilot 输出过程实时更新。

## 命令

| 命令 | 说明 |
|------|------|
| `/new` `/reset` | 清空当前会话 |
| `/stop` | 中断正在运行的任务 |
| `/status` | 查看 cwd、超时、运行状态 |
| `/help` | 命令帮助 |
| `/timeout [分钟\|off]` | 设置当前会话超时 |
| `/cd <path>` | 切换工作目录（owner，重置会话） |
| `/ws list\|save\|use\|remove` | 工作目录别名（owner） |
| `/invite group` | 把当前群加入响应白名单（owner） |
| `/invite admin <open_id>` | 添加管理员（owner） |
| `/remove group\|admin ...` | 移出白名单 / 管理员（owner） |

## 配置

### 数据目录

所有持久化数据在：

```
~/.lark-copilot-bridge/
├── config.json    # 飞书凭证、群白名单、工作目录别名等
└── .env           # 可选环境变量（推荐放这里）
```

首次扫码后**不必**手动填 App ID / Secret。

### 环境变量

复制示例到数据目录（可选）：

```bash
mkdir -p ~/.lark-copilot-bridge
cp .env.example ~/.lark-copilot-bridge/.env
```

| 变量 | 说明 | 默认 |
|------|------|------|
| `COPILOT_CWD` | Copilot 工作目录 | 启动时当前目录 |
| `COPILOT_EXTRA_ARGS` | 追加 copilot 参数 | 无 |
| `COPILOT_TIMEOUT` | 超时（毫秒） | `300000` |
| `LARK_ALLOWED_USERS` | 用户 open_id 白名单，逗号分隔 | 空 = 不限制 |
| `LOG_LEVEL` | 日志级别 | `info` |

也可在聊天里用 `/cd`、`/timeout` 调整，无需改文件。

## 常见问题

**群聊发了消息没反应**  
群聊必须 @ 机器人。若启用了群白名单，owner 需在本群发 `/invite group`。

**提示 copilot 未安装**  
本机执行 `copilot --version` 检查；未登录则运行 `copilot` 完成 GitHub 登录。

**换电脑 / 重装**  
复制 `~/.lark-copilot-bridge/config.json` 到新机器，安装 CLI 后直接 `lark-copilot-bridge` 即可，无需重新扫码（除非要换应用）。

**开发调试**  
Clone 仓库后 `npm install && npm run dev`，等价于跑源码入口。

## 开发

```bash
git clone https://github.com/ma345564280/lark-copilot-bridge.git
cd lark-copilot-bridge
npm install
npm run dev          # 源码热跑
npm run typecheck    # 类型检查
npm run build        # 构建 dist/
```

发布 npm 包：

```bash
npm login
npm publish
```

## 许可证

MIT
