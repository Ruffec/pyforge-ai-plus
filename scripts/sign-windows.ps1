#Requires -Version 5.1
<#
.SYNOPSIS
    使用 signtool 对 Windows 可执行文件/安装包进行代码签名。

.DESCRIPTION
    该脚本只从环境变量读取证书与密码，不会硬编码任何凭据。
    支持以下环境变量：
      - WINDOWS_CERTIFICATE          : .pfx 证书的 Base64 内容
      - WINDOWS_CERTIFICATE_PATH     : .pfx 证书文件路径（与 Base64 二选一）
      - WINDOWS_CERTIFICATE_THUMBPRINT : 已导入证书存储的 SHA-1 指纹（与上述二选一）
      - WINDOWS_CERTIFICATE_PASSWORD : .pfx 证书密码
      - WINDOWS_TIMESTAMP_URL        : 时间戳服务器，默认 http://timestamp.digicert.com
      - WINDOWS_DIGEST_ALGORITHM     : 摘要算法，默认 sha256

.EXAMPLE
    $env:WINDOWS_CERTIFICATE = [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\certs\certificate.pfx"))
    $env:WINDOWS_CERTIFICATE_PASSWORD = "your-password"
    .\scripts\sign-windows.ps1 .\src-tauri\target\release\bundle\nsis\PyForge_AI_*_x64-setup.exe
#>

param(
    [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$Paths,

    [string]$TimestampUrl = $env:WINDOWS_TIMESTAMP_URL,

    [string]$DigestAlgorithm = $env:WINDOWS_DIGEST_ALGORITHM
)

if (-not $TimestampUrl) {
    $TimestampUrl = "http://timestamp.digicert.com"
}

if (-not $DigestAlgorithm) {
    $DigestAlgorithm = "sha256"
}

function Find-Signtool {
    $inPath = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($inPath) {
        return $inPath.Source
    }

    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $found = & $vswhere -products * -latest -find "**\signtool.exe" 2>$null
        if ($found) {
            return $found[0]
        }
    }

    $kitsRoot = "${env:ProgramFiles(x86)}\Windows Kits"
    if (Test-Path $kitsRoot) {
        $candidates = Get-ChildItem -Path $kitsRoot -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending
        if ($candidates) {
            return $candidates[0].FullName
        }
    }

    return $null
}

$signtool = Find-Signtool
if (-not $signtool) {
    throw "无法找到 signtool.exe。请安装 Windows SDK 或 Visual Studio 生成工具。"
}

$certBase64 = $env:WINDOWS_CERTIFICATE
$certPath = $env:WINDOWS_CERTIFICATE_PATH
$certThumbprint = $env:WINDOWS_CERTIFICATE_THUMBPRINT
$certPassword = $env:WINDOWS_CERTIFICATE_PASSWORD

$tempPfx = $null

if ($certThumbprint) {
    Write-Host "使用证书指纹: $certThumbprint"
}
elseif ($certBase64) {
    $tempPfx = Join-Path $env:TEMP "pyforge_sign_cert.pfx"
    [IO.File]::WriteAllBytes($tempPfx, [Convert]::FromBase64String($certBase64))
    $certPath = $tempPfx
    Write-Host "已从 Base64 解码临时证书文件: $tempPfx"
}
elseif ($certPath) {
    if (-not (Test-Path $certPath)) {
        throw "WINDOWS_CERTIFICATE_PATH 指向的文件不存在: $certPath"
    }
    Write-Host "使用证书文件: $certPath"
}
else {
    throw "请设置 WINDOWS_CERTIFICATE、WINDOWS_CERTIFICATE_PATH 或 WINDOWS_CERTIFICATE_THUMBPRINT 之一。"
}

$failed = $false
foreach ($file in $Paths) {
    if (-not (Test-Path $file)) {
        Write-Warning "跳过不存在的文件: $file"
        continue
    }

    $resolved = (Resolve-Path $file).Path
    Write-Host "正在签名: $resolved"

    $signArgs = @("sign")
    if ($certThumbprint) {
        $signArgs += @("/sha1", $certThumbprint)
    }
    else {
        $signArgs += @("/f", $certPath)
        if ($certPassword) {
            $signArgs += @("/p", $certPassword)
        }
    }

    $signArgs += @("/fd", $DigestAlgorithm)
    $signArgs += @("/tr", $TimestampUrl)
    $signArgs += @("/td", $DigestAlgorithm)
    $signArgs += "/v"
    $signArgs += $resolved

    & $signtool $signArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Error "签名失败: $resolved"
        $failed = $true
    }
}

if ($tempPfx -and (Test-Path $tempPfx)) {
    Remove-Item $tempPfx -Force -ErrorAction SilentlyContinue
}

if ($failed) {
    throw "一个或多个文件签名失败。"
}

Write-Host "签名完成。"
