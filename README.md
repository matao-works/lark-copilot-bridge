# lark-copilot-bridge

让你在 **飞书** 里，跟自己电脑上的 **GitHub Copilot** 对话。  
Copilot 会在你指定的文件夹里读文件、改代码；回复会一条条出现在飞书卡片里。

> 你不需要会写代码才能用，但需要会打开「终端」窗口，并保持它开着。

---

## 你需要先准备什么

1. **一台 Mac / Windows / Linux 电脑**（机器人跑在这台电脑上）
2. **[Node.js 20 或更高](https://nodejs.org/)**（官网下载安装包，一路下一步即可）
3. **GitHub Copilot 订阅**，并安装命令行工具：

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

```bash
lark-copilot-bridge
```

第一次会依次问你：

1. **用手机飞书扫二维码**（创建机器人，只需一次）
2. **项目文件夹在哪**（Copilot 只能动这个文件夹里的文件）  
   - Mac：在访达里打开项目文件夹，把路径粘贴过来；或把文件夹拖进终端
3. **谁能用**（推荐选「仅我自己」）

然后终端会显示「已就绪」。请：

1. **不要关闭这个窗口**（关掉 = 机器人下线）
2. 打开飞书，搜索它显示的机器人名称
3. 私聊发一句「你好」试一下

想改文件夹或权限，随时再运行：

```bash
lark-copilot-bridge setup
```

---

## 在飞书里怎么聊

| 你想做的事 | 怎么做 |
|---|---|
| 私聊 | 直接打字发送 |
| 群聊 | 必须 **@机器人**，否则它听不见 |
| 停掉正在做的事 | 点卡片上的 **终止**，或发 `/stop` |
| 换个新话题 | 发 `/new` |
| 看有哪些命令 | 发 `/help` |

---

## 常用终端命令

| 命令 | 干什么 |
|---|---|
| `lark-copilot-bridge` | 启动 |
| `lark-copilot-bridge setup` | 重选项目文件夹 / 谁能用 |
| `lark-copilot-bridge doctor` | 检查是否准备好 |
| `lark-copilot-bridge config` | 看看当前设置 |
| `lark-copilot-bridge logout` | 解除飞书绑定，下次重新扫码 |

---

## 安全提醒（请一定看）

这个机器人能指挥 **你这台电脑** 上的 Copilot 改文件。

- 推荐在设置里选 **「仅我自己」**
- 不要把机器人拉进陌生人可见的群
- 项目文件夹请选具体工程目录，不要选整个「用户主文件夹」

---

## 常见问题

**飞书里没反应？**  
群聊必须 @ 它。也请确认电脑上的终端窗口还开着。

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
