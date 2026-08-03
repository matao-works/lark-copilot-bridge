# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.1.6] - 2026-07-31

### Added
- 正式发布到 npm：`npm install -g lark-copilot-bridge`
- 安装脚本优先从 npm 安装，失败再回退 GitHub

### Fixed
- GitHub 全局安装路径更稳妥（预构建 `dist/`，减少对本地 tsup 的依赖）
- `doctor` 门禁提示更清晰

## [0.1.0] - 2026-07-20

### Added
- 飞书扫码创建机器人，桥接本地 GitHub Copilot CLI
- 流式卡片（思考 / 工具调用 / 正文）
- 前台运行与 `start` 后台常驻（launchd / systemd / 计划任务）
- `/ws` 工作目录别名、附件（图片/文件）、权限控制
- 图文上手指南 `docs/guide.md`
