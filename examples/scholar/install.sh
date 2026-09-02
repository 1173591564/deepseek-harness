#!/usr/bin/env bash
# Scholar DSH 学术专用版 — 一键安装（Linux/macOS；服务器公网模式，token 由管理员私发）
set -euo pipefail
WHEEL="${WHEEL_PATH:-$(dirname "$0")/scholar_studio-0.2.3-py3-none-any.whl}"
TOKEN="${SCHOLAR_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  read -r -p "请输入学术服务器访问 token（管理员私发）: " TOKEN
fi
[ -n "$TOKEN" ] || { echo "token 不能为空"; exit 1; }
echo "[1/2] pip install $WHEEL（含依赖，需可访问 PyPI）"
python3 -m pip install --upgrade --no-cache-dir "$WHEEL"
echo "[2/2] scholar init-dsh（学术模式预设 + one-shot patch，公网 MCP + Bearer 鉴权）"
scholar init-dsh --remote http://47.108.198.147:9845/mcp --token "$TOKEN"
echo "完成。启动学术版：dsh --profile headless，或 dsh web → 预设选「学术模式」"
echo "（备用：公网不可达时用 SSH 隧道 ssh -N -L 9845:127.0.0.1:9845 server-47，并改用 http://127.0.0.1:9845/mcp 重跑 init-dsh）"
