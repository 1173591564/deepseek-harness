# Scholar DSH 学术专用版
# 一键安装：wheel 本地直装 + Proxy Hub 网关接入（一次性兑换码 → 短期 capability）
param(
    [string]$Wheel = "$PSScriptRoot\scholar_studio-0.2.5-py3-none-any.whl",
    [string]$Gateway = $(if ($env:SCHOLAR_GATEWAY_URL) { $env:SCHOLAR_GATEWAY_URL } else { "http://47.108.198.147:8081/v1/mcp/scholar" })
)
$ErrorActionPreference = 'Stop'
$Code = $env:SCHOLAR_ENROLMENT_CODE
if (-not $Code) {
    $Code = Read-Host "请输入学术平台兑换码（一次性 enrolment code，向管理员索取）"
}
if (-not $Code) { throw "兑换码不能为空" }
Write-Host "[1/2] pip install $Wheel（含依赖，需可访问 PyPI）"
python -m pip install --upgrade --no-cache-dir $Wheel
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
Write-Host "[2/2] scholar gateway-login（兑换 capability 并写入学术模式配置）"
scholar gateway-login --gateway $Gateway --code $Code
if ($LASTEXITCODE -ne 0) { throw "gateway-login failed" }
Write-Host "`n完成。启动学术版：dsh --profile headless，或 dsh web → 预设选「学术模式」"
Write-Host "capability 到期后（约30天）向管理员索取新兑换码，重跑 scholar gateway-login 即可。"
