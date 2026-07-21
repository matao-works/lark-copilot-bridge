#!/usr/bin/env bash
# 全局安装 lark-copilot-bridge（无需 clone 仓库）
set -euo pipefail

REPO="github:ma345564280/lark-copilot-bridge"
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

echo "→ 安装 ${PKG}（全局）..."
if npm install -g "$PKG" 2>/dev/null; then
  echo "✓ 已从 npm 安装"
else
  echo "  npm 包未找到，改从 GitHub 安装..."
  npm install -g "$REPO"
  echo "✓ 已从 GitHub 安装"
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  安装完成。运行："
echo ""
echo "    lark-copilot-bridge"
echo ""
echo "  前置：本机已安装并登录 GitHub Copilot CLI"
echo "    curl -fsSL https://gh.io/copilot-install | bash"
echo "    copilot    # 首次 /login"
echo "═══════════════════════════════════════════════════"
