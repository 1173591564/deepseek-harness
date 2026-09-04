#!/usr/bin/env bash
# Scholar DSH 学术专用版 — 一键安装（Linux/macOS；Token onboarding）
set -euo pipefail
WHEEL="${WHEEL_PATH:-$(dirname "$0")/scholar_studio-0.2.6-py3-none-any.whl}"
GATEWAY="http://47.108.198.147:8081/v1/mcp/scholar"
echo "[1/2] pip install $WHEEL（含依赖，需可访问 PyPI）"
python3 -m pip install --upgrade --no-cache-dir "$WHEEL"
echo "[2/2] 初始化 DSH 学术模式（Token 将在 Web UI 首次使用时输入）"
scholar init-dsh --remote "$GATEWAY" --allow-insecure-http
echo "完成。运行 dsh web，选择「学术模式」，首次弹窗只需粘贴 Scholar Token。"
echo "当前测试网关使用 HTTP，Token 会明文传输；正式部署必须切换 HTTPS。"
