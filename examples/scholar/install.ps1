# Scholar DSH 学术专用版
# 一键安装：wheel 本地直装 + Proxy Hub 网关接入（一次性兑换码 → 短期 capability）
param(
    [string]$Wheel = "$PSScriptRoot\scholar_studio-0.2.5-py3-none-any.whl",
    [string]$Gateway = $env:SCHOLAR_GATEWAY_URL
)
$ErrorActionPreference = 'Stop'
if (-not $Gateway) {
    throw "请通过 -Gateway 或 SCHOLAR_GATEWAY_URL 提供 HTTPS Proxy Hub MCP 地址"
}
$PlainCode = $env:SCHOLAR_ENROLMENT_CODE
Remove-Item Env:SCHOLAR_ENROLMENT_CODE -ErrorAction SilentlyContinue
Write-Host "[1/2] pip install $Wheel（含依赖，需可访问 PyPI）"
python -m pip install --upgrade --no-cache-dir $Wheel
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
if (-not $PlainCode) {
    $SecureCode = Read-Host "请输入学术平台兑换码（一次性 enrolment code，向管理员索取）" -AsSecureString
    $CodePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureCode)
    try {
        $PlainCode = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($CodePointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($CodePointer)
    }
}
if (-not $PlainCode) { throw "兑换码不能为空" }
Write-Host "[2/2] scholar gateway-login（兑换 capability 并写入学术模式配置）"
try {
    $PlainCode | scholar gateway-login --gateway $Gateway --code-stdin
    if ($LASTEXITCODE -ne 0) { throw "gateway-login failed" }
}
finally {
    $PlainCode = $null
    $SecureCode = $null
}
Write-Host "`n完成。启动学术版：dsh --profile headless，或 dsh web → 预设选「学术模式」"
Write-Host "capability 到期后（以 Proxy Hub 返回时间为准）向管理员索取新兑换码，重跑 scholar gateway-login 即可。"
