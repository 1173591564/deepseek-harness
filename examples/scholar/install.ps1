# Scholar DSH 学术专用版
# 一键安装：wheel 本地直装 + init-dsh 挂载（HTTPS 或本地 SSH 隧道）
param(
    [string]$Wheel = "$PSScriptRoot\scholar_studio-0.2.3-py3-none-any.whl",
    [string]$Remote = $(if ($env:SCHOLAR_REMOTE_URL) { $env:SCHOLAR_REMOTE_URL } else { "http://127.0.0.1:9845/mcp" })
)
$ErrorActionPreference = 'Stop'
$Token = $env:SCHOLAR_TOKEN
if (-not $Token) {
    $SecureToken = Read-Host "请输入学术服务器访问 token（输入隐藏）" -AsSecureString
    $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
    try {
        $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
    }
}
if (-not $Token) { throw "token 不能为空" }
Write-Host "[1/2] pip install $Wheel（含依赖，需可访问 PyPI）"
python -m pip install --upgrade --no-cache-dir $Wheel
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
Write-Host "[2/2] scholar init-dsh（初始化 15 个技能并写入 DSH managed credential）"
$Token | scholar init-dsh --remote $Remote --token-stdin
$Token = $null
if ($LASTEXITCODE -ne 0) { throw "init-dsh failed" }
Write-Host "`n完成。启动学术版：dsh --profile headless，或 dsh web → 预设选「学术模式」"
Write-Host "默认端点要求 SSH 隧道：ssh -N -L 9845:127.0.0.1:9845 <server>"
Write-Host "公网端点必须通过 -Remote https://.../mcp 或 SCHOLAR_REMOTE_URL 显式指定。"
