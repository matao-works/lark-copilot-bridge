# 冷启动发帖文案（复制即用）

发之前请确认：仓库 README 已 push、npm 包可装、令牌已 revoke。

---

## V2EX（节点建议：分享创造 / 程序员）

**标题：**
出门了还能让 Copilot 改家里电脑上的代码：飞书桥接 GitHub Copilot CLI

**正文：**

做了个小工具：`lark-copilot-bridge`

痛点很简单——人在外面，想让家里/公司那台已经登录好 Copilot 的电脑改两行代码，又不想开远程桌面或 SSH。

用法：
1. 本机 `npm install -g lark-copilot-bridge`
2. 跑一遍扫码，用飞书创建机器人
3. 之后手机飞书私聊发指令；Copilot 在指定文件夹里读改文件
4. 思考过程、工具调用、正文在同一张流式卡片里更新

安全上默认建议「仅我自己」可用，项目目录也别选成整个用户主目录。

- GitHub：https://github.com/matao-works/lark-copilot-bridge
- npm：https://www.npmjs.com/package/lark-copilot-bridge
- 图文指南：https://github.com/matao-works/lark-copilot-bridge/blob/main/docs/guide.md

欢迎试用，安装踩坑可以直接回帖或开 Issue。

---

## 掘金

**标题：**
在飞书里遥控本地 GitHub Copilot：lark-copilot-bridge 开源小记

**标签建议：** 飞书、GitHub Copilot、开源、Node.js、效率工具

**正文：**

### 这是什么

`lark-copilot-bridge` 把「飞书消息」接到「本机 GitHub Copilot CLI」。

你在手机飞书里打字、发图、发文件；Copilot 在电脑上指定的项目目录里读文件、改代码；回复以流式卡片展示——思考、工具调用、正文会在同一张卡上实时更新。

适合：人已经离开工位，但机器还开着、Copilot 已登录的场景。

### 和 SSH / 远程桌面有什么不同

| | SSH / 远程桌面 | lark-copilot-bridge |
|---|---|---|
| 操作方式 | 盯着屏幕键鼠 | 飞书发消息 |
| 上手 | 要会连远程 | 扫码即可 |
| 过程可见性 | 终端自己看 | 流式卡片（思考/工具/正文） |

### 三步上手

```bash
npm install -g lark-copilot-bridge
lark-copilot-bridge doctor
lark-copilot-bridge   # 首次前台：扫码 → 选目录 → 选谁能用
```

飞书能聊之后，可改成后台常驻：

```bash
lark-copilot-bridge start
```

### 安全提醒

- 推荐权限选「仅我自己」
- 不要把机器人拉进陌生人可见的群
- 项目文件夹选具体工程目录，不要选整个用户主目录

### 链接

- 仓库：https://github.com/matao-works/lark-copilot-bridge
- npm：https://www.npmjs.com/package/lark-copilot-bridge
- 图文指南：https://github.com/matao-works/lark-copilot-bridge/blob/main/docs/guide.md

如果这对你有用，欢迎 Star；踩坑欢迎提 Issue。
