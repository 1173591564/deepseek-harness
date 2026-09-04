# Scholar DSH 学术专用版
# 一键安装：wheel 本地直装 + Proxy Hub Scholar Access Key
param(
    [string]$Wheel = "$PSScriptRoot\scholar_studio-0.2.5-py3-none-any.whl",
    [string]$Gateway = $env:SCHOLAR_GATEWAY_URL
)
$ErrorActionPreference = 'Stop'
if (-not $Gateway) {
    throw "请通过 -Gateway 或 SCHOLAR_GATEWAY_URL 提供 HTTPS Proxy Hub MCP 地址"
}
$PlainKey = $env:SCHOLAR_ACCESS_KEY
$PlainCode = $env:SCHOLAR_ENROLMENT_CODE
Remove-Item Env:SCHOLAR_ACCESS_KEY -ErrorAction SilentlyContinue
Remove-Item Env:SCHOLAR_ENROLMENT_CODE -ErrorAction SilentlyContinue
Write-Host "[1/2] pip install $Wheel（含依赖，需可访问 PyPI）"
python -m pip install --upgrade --no-cache-dir $Wheel
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
if (-not $PlainKey -and -not $PlainCode) {
    $SecureKey = Read-Host "请输入管理员签发的 Scholar Access Key" -AsSecureString
    $KeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureKey)
    try {
        $PlainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($KeyPointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($KeyPointer)
    }
}
if (-not $PlainKey -and -not $PlainCode) { throw "Scholar Access Key 不能为空" }
try {
    if ($PlainKey) {
        Write-Host "[2/2] scholar gateway-login（保存 Access Key 并写入学术模式配置）"
        $PlainKey | scholar gateway-login --gateway $Gateway --api-key-stdin
    }
    else {
        Write-Host "[2/2] scholar gateway-login（兼容旧 enrolment/capability 流程）"
        $PlainCode | scholar gateway-login --gateway $Gateway --code-stdin
    }
    if ($LASTEXITCODE -ne 0) { throw "gateway-login failed" }
}
finally {
    $PlainKey = $null
    $PlainCode = $null
    $SecureKey = $null
}
Write-Host "`n完成。启动学术版：dsh --profile headless，或 dsh web → 预设选「学术模式」"
Write-Host "Access Key 的权限、配额、有效期和撤销状态由 Proxy Hub 管理员控制。"
