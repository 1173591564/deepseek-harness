#!/usr/bin/env bash
# Scholar DSH 学术专用版 — 一键安装（Linux/macOS；Proxy Hub 网关模式）
set -euo pipefail
WHEEL="${WHEEL_PATH:-$(dirname "$0")/scholar_studio-0.2.5-py3-none-any.whl}"
GATEWAY="${SCHOLAR_GATEWAY_URL:-}"
ACCESS_KEY="${SCHOLAR_ACCESS_KEY:-}"
CODE="${SCHOLAR_ENROLMENT_CODE:-}"
[ -n "$GATEWAY" ] || {
  echo "请通过 SCHOLAR_GATEWAY_URL 提供 HTTPS Proxy Hub MCP 地址" >&2
  exit 1
}
unset SCHOLAR_ACCESS_KEY SCHOLAR_ENROLMENT_CODE
cleanup_secret() {
  ACCESS_KEY=
  CODE=
}
trap cleanup_secret EXIT
echo "[1/2] pip install $WHEEL（含依赖，需可访问 PyPI）"
python3 -m pip install --upgrade --no-cache-dir "$WHEEL"
if [ -z "$ACCESS_KEY" ] && [ -z "$CODE" ]; then
  read -r -s -p "请输入管理员签发的 Scholar Access Key: " ACCESS_KEY
  printf '\n'
fi
[ -n "$ACCESS_KEY" ] || [ -n "$CODE" ] || {
  echo "Scholar Access Key 不能为空"
  exit 1
}
if [ -n "$ACCESS_KEY" ]; then
  echo "[2/2] scholar gateway-login（保存 Access Key 并写入学术模式配置）"
  printf '%s\n' "$ACCESS_KEY" | scholar gateway-login \
    --gateway "$GATEWAY" --api-key-stdin
else
  echo "[2/2] scholar gateway-login（兼容旧 enrolment/capability 流程）"
  printf '%s\n' "$CODE" | scholar gateway-login \
    --gateway "$GATEWAY" --code-stdin
fi
ACCESS_KEY=
CODE=
trap - EXIT
echo "完成。启动学术版：dsh --profile headless，或 dsh web → 预设选「学术模式」"
echo "Access Key 的权限、配额、有效期和撤销状态由 Proxy Hub 管理员控制。"
