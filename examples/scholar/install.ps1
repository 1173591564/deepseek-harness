# Scholar DSH 学术专用版
# 一键安装：wheel 本地直装 + init-dsh 挂载（服务器公网模式，token 由管理员私发）
param(
    [string]$Wheel = "$PSScriptRoot\scholar_studio-0.2.3-py3-none-any.whl",
    [string]$Token = $env:SCHOLAR_TOKEN
)
$ErrorActionPreference = 'Stop'
if (-not $Token) { $Token = Read-Host "请输入学术服务器访问 token（管理员私发）" }
if (-not $Token) { throw "token 不能为空" }
Write-Host "[1/2] pip install $Wheel（含依赖，需可访问 PyPI）"
python -m pip install --upgrade --no-cache-dir $Wheel
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
Write-Host "[2/2] scholar init-dsh（学术模式预设 + one-shot patch，公网 MCP + Bearer 鉴权）"
scholar init-dsh --remote http://47.108.198.147:9845/mcp --token $Token
if ($LASTEXITCODE -ne 0) { throw "init-dsh failed" }
Write-Host "`n完成。启动学术版：dsh --profile headless，或 dsh web → 预设选「学术模式」"
Write-Host "（备用：公网不可达时用 SSH 隧道 ssh -N -L 9845:127.0.0.1:9845 server-47，并改用 http://127.0.0.1:9845/mcp 重跑 init-dsh）"
