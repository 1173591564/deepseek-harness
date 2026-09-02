#!/usr/bin/env bash
# Scholar DSH 学术专用版 — 一键安装（Linux/macOS；HTTPS 或本地 SSH 隧道）
set -euo pipefail
umask 077
WHEEL="${WHEEL_PATH:-$(dirname "$0")/scholar_studio-0.2.3-py3-none-any.whl}"
REMOTE="${SCHOLAR_REMOTE_URL:-http://127.0.0.1:9845/mcp}"
TOKEN="${SCHOLAR_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  read -r -s -p "请输入学术服务器访问 token（输入隐藏）: " TOKEN
  printf '\n'
fi
[ -n "$TOKEN" ] || { echo "token 不能为空"; exit 1; }
echo "[1/2] pip install $WHEEL（含依赖，需可访问 PyPI）"
python3 -m pip install --upgrade --no-cache-dir "$WHEEL"
echo "[2/2] scholar init-dsh（初始化 15 个技能并写入 DSH managed credential）"
printf '%s\n' "$TOKEN" | scholar init-dsh --remote "$REMOTE" --token-stdin
unset TOKEN
echo "完成。启动学术版：dsh --profile headless，或 dsh web → 预设选「学术模式」"
echo "默认端点要求 SSH 隧道：ssh -N -L 9845:127.0.0.1:9845 <server>"
echo "公网端点必须通过 SCHOLAR_REMOTE_URL=https://.../mcp 显式指定。"
