# Scholar DSH 学术专用版
# 一键安装：wheel 本地直装 + init-dsh 挂载（无需 PyPI）
param([string]$Wheel = "$PSScriptRoot\scholar_studio-0.1.4-py3-none-any.whl")
$ErrorActionPreference = 'Stop'
Write-Host "[1/2] pip install $Wheel"
python -m pip install --force-reinstall --no-deps $Wheel
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
Write-Host "[2/2] scholar init-dsh（生成 cordis.patch.yml scholar 段 + rules）"
scholar init-dsh
if ($LASTEXITCODE -ne 0) { throw "init-dsh failed" }
Write-Host "`n完成。启动学术版：dsh --profile headless（按 init-dsh 输出指引）"
