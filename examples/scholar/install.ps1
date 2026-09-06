# Scholar DSH 学术专用版
# 一键安装：wheel 本地直装 + DSH Token onboarding
param(
    [string]$Wheel = "$PSScriptRoot\scholar_studio-0.2.7-py3-none-any.whl"
)
$ErrorActionPreference = 'Stop'
$Gateway = "http://47.108.198.147:8081/v1/mcp/scholar"
Write-Host "[1/2] pip install $Wheel（含依赖，需可访问 PyPI）"
python -m pip install --upgrade --no-cache-dir $Wheel
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
Write-Host "[2/2] 初始化 DSH 学术模式（Token 将在 Web UI 首次使用时输入）"
scholar init-dsh --remote $Gateway --allow-insecure-http
if ($LASTEXITCODE -ne 0) { throw "scholar init-dsh failed" }
Write-Host "`n完成。运行 dsh web，选择「学术模式」，首次弹窗只需粘贴 Scholar Token。"
Write-Warning "当前测试网关使用 HTTP，Token 会明文传输；正式部署必须切换 HTTPS。"
