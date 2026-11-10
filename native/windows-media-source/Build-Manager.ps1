param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'bin\manager'),
    [string]$HostExecutable,
    [string]$ConfigPath
)
$ErrorActionPreference = 'Stop'
if (!$HostExecutable) { $HostExecutable = & (Join-Path $PSScriptRoot 'Build.ps1') }
if (!$ConfigPath) {
    $ConfigPath = Join-Path $PSScriptRoot 'connector-config.json'
    if (!(Test-Path -LiteralPath $ConfigPath)) {
        $store = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\release\store-config.json') -Raw | ConvertFrom-Json
        $ids = @($store.chromeExtensionId, $store.edgeExtensionId | Where-Object { $_ })
        New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
        $ConfigPath = Join-Path $OutputDirectory 'connector-config.json'
        @{draft=($ids.Count -eq 0); extensionIds=$ids} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
    }
}
$logo = Join-Path $PSScriptRoot 'manager-logo.png'
if (!(Test-Path -LiteralPath $logo)) { $logo = Join-Path $PSScriptRoot '..\..\resource\icons\lunar-v2-128.png' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$resources = @{
    'payload.LunarMediaHost.exe' = $HostExecutable
    'payload.connector-config.json' = $ConfigPath
    'payload.Install.ps1' = (Join-Path $PSScriptRoot 'Install.ps1')
    'payload.Uninstall.ps1' = (Join-Path $PSScriptRoot 'Uninstall.ps1')
    'payload.Uninstall.cmd' = (Join-Path $PSScriptRoot 'Uninstall.cmd')
    'payload.logo.png' = $logo
}
$source = Join-Path $PSScriptRoot 'Manager.cs'
$darkUi = Join-Path $PSScriptRoot 'DarkUi.cs'
$localeSource = Join-Path $PSScriptRoot 'ManagerLocale.cs'
foreach ($language in @('zh-CN', 'en', 'yue', 'ja', 'ko', 'th', 'ms')) {
    $resources[('payload.language.' + $language + '.json')] = Join-Path $PSScriptRoot ('languages\' + $language + '.json')
}
$hashInput = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
$hashInput += (Get-FileHash -LiteralPath $darkUi -Algorithm SHA256).Hash
$hashInput += (Get-FileHash -LiteralPath $localeSource -Algorithm SHA256).Hash
$hashInput += (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash
foreach ($name in ($resources.Keys | Sort-Object)) {
    if (!(Test-Path -LiteralPath $resources[$name] -PathType Leaf)) { throw "Missing manager resource: $name" }
    $hashInput += (Get-FileHash -LiteralPath $resources[$name] -Algorithm SHA256).Hash
}
$hash = [Security.Cryptography.SHA256]::Create()
try { $version = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($hashInput)))).Replace('-', '').Substring(0, 12).ToLowerInvariant() } finally { $hash.Dispose() }
$buildDirectory = Join-Path $OutputDirectory $version
New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null
$executable = Join-Path $buildDirectory 'LunarConnectorManager.exe'
if (!(Test-Path -LiteralPath $executable)) {
    # Convert the existing extension artwork to a Windows icon resource.
    # DIB encoding also supports .NET Framework's window/taskbar icon loader.
    $iconPath = Join-Path $buildDirectory 'lunar.ico'
    Add-Type -AssemblyName System.Drawing
    $bitmap = New-Object Drawing.Bitmap($logo)
    $width = $bitmap.Width; $height = $bitmap.Height
    $pixelBytes = $width * $height * 4
    $maskBytes = [int]([Math]::Ceiling($width / 32.0) * 4) * $height
    $iconStream = [IO.File]::Create($iconPath)
    $writer = New-Object IO.BinaryWriter($iconStream)
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
        $writer.Write([byte]$width); $writer.Write([byte]$height); $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32](40 + $pixelBytes + $maskBytes)); $writer.Write([uint32]22)
        $writer.Write([uint32]40); $writer.Write([int]$width); $writer.Write([int]($height * 2))
        $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]0); $writer.Write([uint32]$pixelBytes)
        foreach ($unused in 1..4) { $writer.Write([uint32]0) }
        $pixels = $bitmap.LockBits((New-Object Drawing.Rectangle(0, 0, $width, $height)), [Drawing.Imaging.ImageLockMode]::ReadOnly, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $rowBytes = New-Object byte[] ($width * 4)
            for ($row = $height - 1; $row -ge 0; $row--) {
                [Runtime.InteropServices.Marshal]::Copy([IntPtr]::Add($pixels.Scan0, ($row * $pixels.Stride)), $rowBytes, 0, $rowBytes.Length)
                $writer.Write($rowBytes)
            }
        } finally { $bitmap.UnlockBits($pixels) }
        $writer.Write((New-Object byte[] $maskBytes))
    } finally { $writer.Dispose(); $iconStream.Dispose(); $bitmap.Dispose() }
    $arguments = @('/nologo', '/optimize+', '/target:winexe', '/platform:anycpu', ('/out:' + $executable), ('/win32icon:' + $iconPath), ('/resource:' + $iconPath + ',payload.app.ico'), '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll')
    foreach ($name in ($resources.Keys | Sort-Object)) { $arguments += ('/resource:' + $resources[$name] + ',' + $name) }
    & $compiler @arguments $source $darkUi $localeSource
    if ($LASTEXITCODE -ne 0) { throw 'Connector manager build failed.' }
}
Write-Output ([IO.Path]::GetFullPath($executable))
