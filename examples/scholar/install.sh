#!/usr/bin/env bash
# Scholar DSH 学术专用版 — 一键安装（Linux/macOS）
set -euo pipefail
WHEEL="${1:-$(dirname "$0")/scholar_studio-0.2.1-py3-none-any.whl}"
echo "[1/2] pip install $WHEEL（含依赖，需可访问 PyPI）"
python3 -m pip install --upgrade --no-cache-dir "$WHEEL"
echo "[2/2] scholar init-dsh"
scholar init-dsh
echo "完成。启动学术版：dsh --profile headless（按 init-dsh 输出指引）"
echo "无本地知识库？先 scholar init 建库，或配置 SCHOLAR_PG_*/SCHOLAR_NEO4J_* 连接团队服务器。"
