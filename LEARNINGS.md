# 学习笔记：从 lark-channel-bridge 到 lark-copilot-bridge

本文记录对原项目 [`zarazhangrui/lark-coding-agent-bridge`](https://github.com/zarazhangrui/lark-coding-agent-bridge)（即 `lark-channel-bridge`）的架构分析，以及我们在 `lark-copilot-bridge` 中做了哪些取舍。读完这份笔记，你就能理解每一层为什么这么设计。

---

## 一、原项目在解决什么问题

一句话：**让你在飞书里 @ 一个机器人，它就把消息转发给本地运行的编码代理（Claude Code / Codex CLI），再把代理的输出流式回传到飞书卡片上。**

它不是"飞书机器人调 LLM API"——那样很简单。它的本质是**桥接两个进程**：飞书平台的事件流 和 本地 CLI 代理的 stdin/stdout。难点全在"桥接"上：

- 飞书侧怎么不开公网就把消息收进来
- CLI 代理的流式输出怎么实时显示到飞书卡片上
- 多个聊天同时说话怎么排队
- 会话怎么保持连续
- 安全：谁能用、能干什么

---

## 二、原项目的四层架构

```
飞书用户 ←(WebSocket)→ 飞书平台 ←(WebSocket)→ lark-channel-bridge ←(spawn)→ claude/codex CLI
```

### 第 1 层：飞书侧接入（WebSocket 长连接）

**关键决策：不用 Webhook 回调，用 WebSocket 长连接。**

传统飞书机器人需要：公网服务器 + 回调 URL + 签名验证 + 加解密。这套东西部署很重。

原项目用飞书的 **PersonalAgent 应用 + lark-cli** 机制：lark-cli 是飞书官方 CLI（`@larksuite/cli`），它存的凭证（`LARKSUITE_CLI_CONFIG_DIR` 指向的目录）里包含 app_id/app_secret。桥接程序复用这些凭证，自己建立 WebSocket 长连接接收事件——**不需要公网 IP、不需要内网穿透**。

> **我们的实现（与原项目完全对齐）**：同样用 `@larksuite/channel` 这个飞书官方高层包：
> - `registerApp({ onQRCodeReady })` — 扫码创建飞书应用，终端打印二维码（`qrcode-terminal`），用户飞书扫码确认后返回 `client_id` / `client_secret`
> - `createLarkChannel({ appId, appSecret, ... })` — 建 WS 长连接，SDK 自动处理 ping/pong/重连/消息去重
> - `channel.on({ message })` — 收消息，SDK 把事件规范化成 `NormalizedMessage`（`content` 已预处理、`mentionedBot` 已判断好）
> - `channel.stream({ card: { initial, producer } })` — 流式卡片：先发 initial，producer 里 `ctrl.update(newCard)` 增量 patch
>
> **踩过的坑**（前两次实现都跑偏了）：
> 1. 第一次用 `@larksuiteoapi/node-sdk` 的 `WSClient` + 让用户手动建应用填凭证 → 体验差
> 2. 第二次以为原项目用 `lark-cli event consume` + `config init --new` → 错！lark-cli 不能建应用，只能绑定已有应用
> 3. **正确答案**：原项目从头到尾用的是 `@larksuite/channel` 的 `registerApp()`，这才是"扫码建应用"的官方入口。详见 `src/lark/client.ts`。

### 第 2 层：消息处理（队列 + 合批 + 命令路由）

收到消息后不是立刻 spawn 代理，而是经过一条流水线：

1. **权限校验**：默认只有创建者能用。三层 ACL：`allowedUsers`（私聊白名单）、`allowedChats`（群白名单）、`admins`（管理员）
2. **斜杠命令分流**：`/new`、`/cd`、`/ws`、`/stop` 等命令不进代理，直接本地处理
3. **入队合批**：用户快速连发几条消息时，合并成一次请求（避免每条都 spawn 一次进程）
4. **运行中排队**：代理正在跑时收到的新消息，排队等下一轮

> **我们的取舍**：MVP 只实现核心子集——单用户白名单 + 4 个命令（`/new` `/help` `/stop` `/status`）+ 运行中排队。合批先不做（每条消息独立处理），保持代码简单。详见 `src/queue.ts`、`src/commands.ts`。

### 第 3 层：代理适配（spawn CLI 子进程）

这是最值得学的一层。原项目对 `claude` 和 `codex` CLI 各写了一个适配器，核心是：

- **spawn 子进程**：`claude --resume <sessionId> --cwd <workspace> -p "<prompt>" --output-format stream-json`
- **解析 stdout 流**：claude/codex 用 `stream-json` 格式输出结构化事件（`tool_use`、`text`、`final` 等），适配器逐行 parse
- **会话恢复**：`--resume <sessionId>` 让 CLI 代理自己保持上下文，桥接程序只需记 sessionId
- **权限模式映射**：`full`→`bypassPermissions`、`workspace`→`acceptEdits`、`read-only`→`plan`
- **中断**：`AbortController` + 进程 kill
- **看门狗**：N 分钟无 stdout 输出自动 kill，防止进程卡死

> **我们的取舍（最大差异点）**：`copilot` CLI 的能力模型不同：
> - 调用方式：`copilot -p "<prompt>" -s --no-ask-user`（`-s` 静默输出纯文本，`--no-ask-user` 不问澄清问题）
> - **不支持 `--resume`**：copilot CLI 没有会话恢复，所以我们**自己维护消息历史**，每次把历史拼进 prompt
> - **不支持结构化流式事件**：copilot 输出是文本流，我们收集完整 stdout 后一次性回复（不做增量 PATCH 卡片）
> - 权限：用 `--allow-tool` / `--allow-url` 控制
>
> 这个差异决定了我们的 `src/copilot/adapter.ts` 和 `src/session.ts` 的设计。详见对应文件注释。

### 第 4 层：飞书卡片回传（流式更新）

原项目的"流式卡片"是最有特色的功能：

1. 收到消息后，先用 `im.message.create` 发一张**初始卡片**（"思考中..."）
2. 代理输出过程中，用 `im.message.patch` **增量更新**这张卡片（显示工具调用、中间文本）
3. 代理结束后，用最终文本 **再 patch 一次**

这样用户在飞书里能看到代理"实时打字"的效果。

> **我们的取舍**：MVP 做两步——先发"思考中"卡片，代理结束后 patch 成最终回复。不做中间增量（copilot 也不输出结构化中间事件）。流式增量留作进阶练习。详见 `src/lark/card.ts`。

---

## 三、原项目的工程化设计（我们 MVP 暂不实现）

这些是原项目的"完整版"特性，列出供学习参考，我们的 MVP 先不做：

| 特性 | 原项目做法 | 为什么 MVP 先不做 |
|------|-----------|------------------|
| **多 Profile** | 每个 profile 独立凭证/会话/工作区，可同时跑 claude 和 codex 两个 bot | 单用户单代理够学核心 |
| **后台服务** | macOS launchd / Linux systemd / Windows Task Scheduler | 前台 `npm start` 够用 |
| **凭证加密** | App Secret 用 AES-256-GCM 加密落盘 | .env 明文够用（别提交 git） |
| **COT 模式** | brief/detailed 控制中间过程可见度 | copilot 无结构化中间事件 |
| **图片/文件** | 下载到 media/ 再注入 prompt | 纯文本优先 |
| **工作区切换** | `/cd`、`/ws save/use` | 配置里写死 cwd |
| **云文档评论** | 在文档评论里 @bot 触发 | 私聊+群聊优先 |
| **空闲看门狗** | N 分钟无输出自动 kill | 用简单超时代替 |
| **遥测** | 可插拔遥测模块 | 不需要 |

---

## 四、数据流：一条消息的完整旅程（我们的实现）

```
1. 用户在飞书发 "@bot 帮我看看这个函数"
   ↓
2. createLarkChannel 的 message 事件回调收到 NormalizedMessage
   ↓
3. src/lark/client.ts 的 onMessage 处理（extractText 去掉 @占位符）
   ↓
4. src/commands.ts 判断：是 / 命令吗？
   ├─ 是 → 本地处理（/new 清会话 /help 发帮助卡 /stop 杀进程 /status 报状态）
   └─ 否 → 进入消息队列 src/queue.ts
   ↓
5. 队列检查：当前 chat 有没有在跑的任务？
   ├─ 有 → 入队，等当前任务跑完再处理
   └─ 无 → 立即处理
   ↓
6. src/lark/card.ts 先发一张"思考中..."卡片，拿到 message_id
   ↓
7. src/session.ts 取出该 chat 的历史消息，拼成上下文
   ↓
8. src/copilot/adapter.ts spawn 子进程：
   copilot -p "<带历史的 prompt>" -s --no-ask-user --cwd <workspace>
   ↓
9. 收集 stdout，等进程结束（或超时/中断）
   ↓
10. 把完整输出写回 session 历史
   ↓
11. src/lark/card.ts patch 卡片为最终回复
   ↓
12. 检查队列里有没有排队的消息，有则继续处理
```

---

## 五、关键技术点深入

### 5.1 飞书长连接 vs Webhook

| | 长连接 (WSClient) | Webhook 回调 |
|---|---|---|
| 公网 IP | **不需要** | 需要 |
| 内网穿透 | **不需要** | 开发时需要 |
| 加解密 | 仅连接时认证，事件明文 | 每次都要验签解密 |
| 部署 | 本地直接跑 | 需要服务器/云函数 |
| 集群 | 仅随机一个客户端收到 | 所有实例都能收 |

长连接的唯一限制：**收到消息后 3 秒内要处理完**，否则会重推。所以重活（spawn copilot）必须异步化，先 ack 再慢慢处理。

### 5.2 为什么 copilot 适配器和 claude/codex 不同

`claude --output-format stream-json` 会输出这样的结构化流：
```json
{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
{"type":"tool_use","name":"Read","input":{...}}
{"type":"result","result":"..."}
```
原项目逐行 parse，实时更新卡片。

`copilot -p "..." -s` 输出的是**纯文本**，没有结构化事件，也不一定按行流式（取决于任务复杂度）。所以我们选择：收集完整 stdout 后一次性回复。这是 MVP 的合理取舍。

### 5.3 会话连续性：--resume vs 自维护历史

- **claude/codex**：`--resume <sessionId>` 让 CLI 自己记上下文，桥接只存一个 sessionId 字符串
- **copilot**：没有 resume，我们维护 `Map<chat_id, Message[]>`，每次把历史拼进 prompt

自维护历史的代价：prompt 会越来越长（token 消耗增大）。MVP 用简单策略——保留最近 N 轮（默认 10 轮）。进阶可以做摘要压缩。

### 5.4 飞书卡片消息的 create + patch 模式

```typescript
// 1. 创建初始卡片，拿到 message_id
const createResp = await client.im.v1.message.create({
  params: { receive_id_type: 'chat_id' },
  data: { receive_id, msg_type: 'interactive', content: JSON.stringify(card) }
});
const messageId = createResp.data.message_id;

// 2. 后续用 patch 更新同一张卡片
await client.im.v1.message.patch({
  path: { message_id: messageId },
  data: { content: JSON.stringify(newCard) }
});
```
patch 只能改卡片内容，不能改 msg_type。这就是"流式更新"的基础。

---

## 六、参考资料

- 原项目：https://github.com/zarazhangrui/lark-coding-agent-bridge
- 飞书 Node SDK：https://github.com/larksuite/node-sdk
- 飞书长连接文档：https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/event-subscription-guide/long-connection-mode
- 飞书事件列表：https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-list
- GitHub Copilot CLI：https://github.com/github/copilot-cli
- Copilot CLI 编程调用：https://docs.github.com/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically
- lark-cli（飞书官方 CLI）：https://github.com/larksuite/cli
