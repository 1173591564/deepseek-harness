#!/usr/bin/env bash
# Scholar DSH 学术专用版 — 一键安装（Linux/macOS；Proxy Hub 网关模式）
set -euo pipefail
WHEEL="${WHEEL_PATH:-$(dirname "$0")/scholar_studio-0.2.5-py3-none-any.whl}"
GATEWAY="${SCHOLAR_GATEWAY_URL:-http://47.108.198.147:8081/v1/mcp/scholar}"
CODE="${SCHOLAR_ENROLMENT_CODE:-}"
if [ -z "$CODE" ]; then
  read -r -p "请输入学术平台兑换码（一次性 enrolment code，向管理员索取）: " CODE
fi
[ -n "$CODE" ] || { echo "兑换码不能为空"; exit 1; }
echo "[1/2] pip install $WHEEL（含依赖，需可访问 PyPI）"
python3 -m pip install --upgrade --no-cache-dir "$WHEEL"
echo "[2/2] scholar gateway-login（兑换 capability 并写入学术模式配置）"
scholar gateway-login --gateway "$GATEWAY" --code "$CODE"
echo "完成。启动学术版：dsh --profile headless，或 dsh web → 预设选「学术模式」"
echo "capability 到期后（约30天）向管理员索取新兑换码，重跑 scholar gateway-login 即可。"
