#!/usr/bin/env bash
# 全局安装 lark-copilot-bridge（无需 clone 仓库）
set -euo pipefail

REPO="github:matao-works/lark-copilot-bridge"
PKG="lark-copilot-bridge"

need_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "✗ 未检测到 Node.js。请先安装 Node.js >= 20：" >&2
    echo "  https://nodejs.org/" >&2
    exit 1
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [ "$major" -lt 20 ]; then
    echo "✗ 需要 Node.js >= 20，当前: $(node -v)" >&2
    exit 1
  fi
}

need_node

echo "→ 安装 ${PKG}（从 GitHub）..."
if ! npm install -g "$REPO"; then
  echo "→ 直接安装失败，改用 pack 回退…"
  TMP="$(mktemp -d)"
  cleanup() { rm -rf "$TMP"; }
  trap cleanup EXIT
  (
    cd "$TMP"
    npm pack "$REPO"
    # shellcheck disable=SC2086
    npm install -g ./lark-copilot-bridge-*.tgz
  )
  trap - EXIT
  cleanup
fi
echo "✓ 已安装 $(lark-copilot-bridge --version 2>/dev/null || echo ok)"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  安装完成。按下面做即可："
echo ""
echo "    1) lark-copilot-bridge doctor   # 检查是否准备好"
echo "    2) lark-copilot-bridge         # 启动（首次会引导设置）"
echo ""
echo "  你还需要：已登录的 GitHub Copilot 命令行"
echo "    curl -fsSL https://gh.io/copilot-install | bash"
echo "    copilot   # 按提示登录"
echo "═══════════════════════════════════════════════════"
