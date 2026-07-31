# 飞书里用上本地 Copilot

这是一份给「不太写代码也能上手」的图文指南。  
想直接看命令表，请回 [README](../README.md)。

---

## 这是什么

`lark-copilot-bridge` 把两件事接在一起：

- 你在 **飞书** 里打字、发图、发文件
- 本机上的 **GitHub Copilot CLI** 在你指定的文件夹里读文件、改代码

回复会以**同一张流式卡片**更新：思考、工具调用、正文都会实时写在上面。

![飞书消息经小黑塞进本机文件夹](../assets/guide-illustrations/01-bridge-funnel.png)

你不需要会写代码才能用。机器人跑在**你自己的电脑**上——飞书只是遥控器。

---

## 先准备四样东西

1. 一台 Mac / Windows / Linux（机器人跑在这台机器上）
2. [Node.js 20+](https://nodejs.org/)
3. GitHub Copilot 订阅，并装好 CLI（建议 ≥ 1.0.49）：

```bash
curl -fsSL https://gh.io/copilot-install | bash
copilot
```

按提示登录 GitHub；登录成功后可关掉这个窗口。

4. 手机飞书（用来扫码创建机器人）

---

## 前台守着，还是后台常驻？

两种跑法：

| 方式 | 命令 | 特点 |
|---|---|---|
| 前台 | `lark-copilot-bridge` | 终端窗口必须一直开着 |
| 后台常驻（推荐） | `lark-copilot-bridge start` | 关掉终端也在线；登录后可自动起来 |

![前台扶窗 vs 后台自转](../assets/guide-illustrations/02-foreground-vs-daemon.png)

服务命令请用**全局安装**的 CLI。不要用 `npx … start`——守护进程会记下临时缓存路径，缓存一清就挂。

---

## 三步开始用

### ① 安装

```bash
npm install -g github:ma345564280/lark-copilot-bridge
```

或：

```bash
curl -fsSL https://raw.githubusercontent.com/ma345564280/lark-copilot-bridge/main/scripts/install.sh | bash
```

### ② 体检（推荐）

```bash
lark-copilot-bridge doctor
```

全是 ✓ 再往下走；有 ✗ 就按它提示的「→」处理。

### ③ 启动

```bash
lark-copilot-bridge start
lark-copilot-bridge status
```

第一次会依次问你：扫码创建机器人 → 选项目文件夹 → 谁能用（推荐「仅我自己」）。

![安装、体检、开门三道闸](../assets/guide-illustrations/03-three-gates.png)

终端显示「已就绪」后：打开飞书，搜机器人名称，私聊发一句「你好」。

想改文件夹或权限，随时再跑：

```bash
lark-copilot-bridge setup
```

---

## 在飞书里怎么聊

- **私聊**：直接发
- **群聊**：必须 **@机器人**，否则听不见
- **图片 / 文件**：直接发（群聊同样要 @）；会先下到本机再交给 Copilot
- **看进度**：同一张卡片会更新思考 / 工具 / 正文
- **停下**：点卡片上的「终止」，或发 `/stop`
- **新话题**：`/new`
- **看状态**：`/status`
- **换项目文件夹**：`/cd 路径`（管理员）
- **命名工作目录**：`/ws`（管理员；详见 README）

![群聊拉 @ 绳，卡片在呼吸](../assets/guide-illustrations/04-at-and-live-card.png)

若 `doctor` 提示不支持 json 输出，卡片会降级为纯文本流式。升级 Copilot CLI 即可。

---

## 安全：窄门只进一个项目箱

这个机器人能指挥 **你这台电脑** 上的 Copilot 改文件。

![窄门守着，整栋家挡在门外](../assets/guide-illustrations/05-narrow-gate-security.png)

请记住三件事：

1. 设置里选 **「仅我自己」**
2. 不要把机器人拉进陌生人可见的群
3. 项目文件夹选**具体工程目录**，不要选整个用户主文件夹

---

## 卡住了？

- **飞书没反应**：群聊是否 @ 了？前台模式终端是否还开着？`start` 后跑一下 `lark-copilot-bridge status`
- **提示没有 Copilot**：终端跑 `copilot` 登录；确认订阅有效
- **改错文件夹**：`lark-copilot-bridge setup` 重选
- **换电脑**：新电脑重新安装并扫码；或拷贝 `~/.lark-copilot-bridge/config.json`（高级）

更多命令与进阶配置见 [README](../README.md)。

---

## 插画说明

正文配图采用「小黑」怪诞手绘风格，生成流程参考开源 Skill  
[ian-xiaohei-illustrations](https://github.com/helloianneo/ian-xiaohei-illustrations)（MIT）。
