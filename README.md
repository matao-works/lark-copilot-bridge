# lark-copilot-bridge

让你在 **飞书** 里，跟自己电脑上的 **GitHub Copilot** 对话。  
Copilot 会在你指定的文件夹里读文件、改代码；回复以**流式卡片**展示——思考过程、工具调用、正文会实时更新在同一张卡片上。

> 你不需要会写代码才能用。推荐用 `start` 做成后台常驻；前台跑也可以，但要保持终端窗口开着。

图文上手指南（小黑配图）：[docs/guide.md](docs/guide.md)

---

## 你需要先准备什么

1. **一台 Mac / Windows / Linux 电脑**（机器人跑在这台电脑上）
2. **[Node.js 20 或更高](https://nodejs.org/)**（官网下载安装包，一路下一步即可）
3. **GitHub Copilot 订阅**，并安装命令行工具（建议 **≥ 1.0.49**，以支持卡片里显示工具调用）：

```bash
curl -fsSL https://gh.io/copilot-install | bash
copilot
```

打开后按提示登录 GitHub。登录成功即可关掉这个 `copilot` 窗口。

4. **手机上的飞书**，用来扫码创建机器人

---

## 三步开始用

### ① 安装

在终端粘贴：

```bash
npm install -g github:ma345564280/lark-copilot-bridge
```

或：

```bash
curl -fsSL https://raw.githubusercontent.com/ma345564280/lark-copilot-bridge/main/scripts/install.sh | bash
```

### ② 检查一下（推荐）

```bash
lark-copilot-bridge doctor
```

全是 ✓ 就可以进入下一步。若有 ✗，按它提示的「→」去做。

### ③ 启动

**第一次请先前台跑一遍**（扫码、选项目文件夹、选谁能用）：

```bash
lark-copilot-bridge
```

第一次会依次问你：

1. **用手机飞书扫二维码**（创建机器人，只需一次）
2. **项目文件夹在哪**（Copilot 只能动这个文件夹里的文件）  
   - Mac：在访达里打开项目文件夹，把路径粘贴过来；或把文件夹拖进终端
3. **谁能用**（推荐选「仅我自己」）

然后终端会显示「已就绪」。请：

1. 打开飞书，搜索它显示的机器人名称
2. 私聊发一句「你好」试一下
3. 也可直接发**图片或文件**（会下载到本机再交给 Copilot）

飞书已经能聊之后，再改成**后台常驻**（关掉终端也继续在线；登录后自动起来）：

```bash
lark-copilot-bridge start
lark-copilot-bridge status
```

> 服务命令必须用**全局安装**的 CLI。不要用 `npx … start`——守护进程会记下临时缓存路径，缓存一清就挂。  
> `start` **不会**带你扫码；没绑定或没选好文件夹时会失败，并提示你先跑前台或 `setup`。

想改文件夹或权限，随时再运行：

```bash
lark-copilot-bridge setup
```

若正在用后台常驻，改完后执行一次 `lark-copilot-bridge restart`。

---

## 在飞书里怎么聊

| 你想做的事 | 怎么做 |
|---|---|
| 私聊 | 直接打字发送 |
| 群聊 | 必须 **@机器人**，否则它听不见 |
| 发图片 / 文件 | 直接发给机器人（群聊同样要 @）；本机缓存后交给 Copilot |
| 看它在干什么 | 同一张卡片会显示思考 / 调用的工具 / 正在输出的正文 |
| 停掉正在做的事 | 点卡片上的 **终止**，或发 `/stop` |
| 换个新话题 | 发 `/new` |
| 看当前状态 | 发 `/status`（cwd / 会话 / 队列 / 后台服务 / 附件缓存） |
| 看有哪些命令 | 发 `/help` |
| 换项目文件夹 | `/cd 路径`（管理员） |
| 命名工作目录 | `/ws`（见下；管理员） |

### `/ws` 命名工作目录

别名存在 `~/.lark-copilot-bridge/workspaces.json`（若旧版写在 `config.json` 里会自动迁移）。仅管理员可用。

| 命令 | 作用 |
|---|---|
| `/ws` / `/ws list` | 列出别名，并标出当前 cwd |
| `/ws add <name> [path]` | 保存别名；省略 path 则用当前 cwd |
| `/ws save <name>` | 把当前 cwd 存成别名 |
| `/ws use <name>` | 切换到该目录（本会话重置；下次启动默认也用此目录） |
| `/ws rm <name>` | 删除别名 |

> 若 `doctor` 提示不支持 json 输出，卡片会降级为纯文本流式（不显示工具块）。升级 Copilot CLI 即可。

---

## 常用终端命令

| 命令 | 干什么 |
|---|---|
| `lark-copilot-bridge` / `run` | 前台启动 |
| `lark-copilot-bridge start` | 安装并启动后台常驻（launchd / systemd / 计划任务） |
| `lark-copilot-bridge stop` | 停止并取消开机自启 |
| `lark-copilot-bridge restart` | 重启后台服务 |
| `lark-copilot-bridge status` | 是否在跑、pid、日志路径 |
| `lark-copilot-bridge unregister` | 清除守护进程注册（保留配置） |
| `lark-copilot-bridge setup` | 重选项目文件夹 / 谁能用 |
| `lark-copilot-bridge doctor` | 检查是否准备好 |
| `lark-copilot-bridge config` | 看看当前设置 |
| `lark-copilot-bridge logout` | 解除飞书绑定，下次重新扫码 |

Linux 用户若希望注销后服务仍在：`loginctl enable-linger $USER`（一次即可）。

后台日志默认在：

```
~/.lark-copilot-bridge/logs/daemon-stdout.log
~/.lark-copilot-bridge/logs/daemon-stderr.log
```

附件缓存：

```
~/.lark-copilot-bridge/media/
```

（按内容哈希命名；启动时清理超过 24 小时的文件）

---

## 安全提醒（请一定看）

这个机器人能指挥 **你这台电脑** 上的 Copilot 改文件。

- 推荐在设置里选 **「仅我自己」**
- 不要把机器人拉进陌生人可见的群
- 项目文件夹请选具体工程目录，不要选整个「用户主文件夹」

---

## 常见问题

**飞书里没反应？**  
群聊必须 @ 它。若是前台模式，确认终端窗口还开着；若用了 `start`，运行 `lark-copilot-bridge status` 看是否在线。

**提示没有 Copilot？**  
在终端运行 `copilot`，按提示登录。需要有效的 Copilot 订阅。

**它改错文件夹了？**  
运行 `lark-copilot-bridge setup`，重新选项目文件夹。

**换电脑了？**  
在新电脑重新安装并扫码；或把旧电脑的 `~/.lark-copilot-bridge/config.json` 拷过去（高级用法）。

**想换一个飞书机器人？**  
```bash
lark-copilot-bridge logout
lark-copilot-bridge
```

---

## 进阶配置（可选）

设置保存在：

```
~/.lark-copilot-bridge/config.json
```

也可以放环境变量（一般不用手动改）：

| 变量 | 含义 |
|---|---|
| `COPILOT_CWD` | 项目文件夹 |
| `LARK_ALLOWED_USERS` | 允许使用的用户 ID（逗号分隔） |
| `COPILOT_TIMEOUT` | 超时毫秒数，默认 5 分钟 |
| `LOG_LEVEL` | 日志详细程度 |

---

## 开发者

```bash
git clone https://github.com/ma345564280/lark-copilot-bridge.git
cd lark-copilot-bridge
npm install
npm run dev
```

## 许可证

MIT
