param([string]$ManagerExecutable, [switch]$RenderPreview)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$ManagerExecutable) { $ManagerExecutable = & (Join-Path $workspace 'native\windows-media-source\Build-Manager.ps1') }
$assembly = [Reflection.Assembly]::LoadFile([IO.Path]::GetFullPath($ManagerExecutable))
$backendType = $assembly.GetType('LunarStart.ConnectorManager.ConnectorBackend', $true)
$flags = [Reflection.BindingFlags]'Instance,NonPublic'
$constructor = $backendType.GetConstructor($flags, $null, [type[]]@([string], [string[]]), $null)
$inspect = $backendType.GetMethod('Inspect', $flags)
$execute = $backendType.GetMethod('Execute', $flags)
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("LunarManager-test-' spaced-" + [Guid]::NewGuid().ToString('N'))
$installRoot = Join-Path $testRoot 'LunarStart\MediaConnector'
$registryRoot = 'Software\LunarStart\ManagerTests\' + [Guid]::NewGuid().ToString('N')
$registryPaths = [string[]]@(($registryRoot + '\Chrome'), ($registryRoot + '\Edge'))
$hostName = 'com.lunarfox.lunar_media'
$productionPaths = @(('Software\Google\Chrome\NativeMessagingHosts\' + $hostName), ('Software\Microsoft\Edge\NativeMessagingHosts\' + $hostName))
function Read-Registration([string]$path) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path)
    if ($null -eq $key) { return '' }
    try { return [string]$key.GetValue('') } finally { $key.Dispose() }
}
$originalRegistrations = @($productionPaths | ForEach-Object { Read-Registration $_ })
$backend = $constructor.Invoke([object[]]@([string]$installRoot, [string[]]$registryPaths))
function Status { return $inspect.Invoke($backend, @()) }
function Field($value, [string]$name) { return $value.GetType().GetField($name, [Reflection.BindingFlags]'Instance,Public,NonPublic').GetValue($value) }
function Assert-State([string]$expected) {
    $actual = [string](Field (Status) 'State')
    if ($actual -ne $expected) { throw "Expected $expected, found $actual" }
}
function Run-Operation([bool]$remove, [string[]]$ids) {
    try { return $execute.Invoke($backend, [object[]]@([bool]$remove, [string[]]$ids, [bool]$true)) }
    catch { throw $_.Exception.GetBaseException() }
}
function Register-Fixture {
    foreach ($path in $registryPaths) {
        if (!$path.StartsWith($registryRoot + '\', [StringComparison]::Ordinal)) { throw 'Unsafe test registry path' }
        $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($path)
        try { $key.SetValue('', (Join-Path $installRoot ($hostName + '.json'))) } finally { $key.Dispose() }
    }
}
function Render-Preview([string]$name) {
    if (!$RenderPreview) { return }
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    [Windows.Forms.Application]::EnableVisualStyles()
    $formType = $assembly.GetType('LunarStart.ConnectorManager.ManagerForm', $true)
    $formConstructor = $formType.GetConstructor($flags, $null, [type[]]@($backendType), $null)
    $localeType = $assembly.GetType('LunarStart.ConnectorManager.ManagerLocale', $true)
    $languageCodes = [string[]]$localeType.GetField('Codes', [Reflection.BindingFlags]'Static,NonPublic').GetValue($null)
    if ($languageCodes.Count -ne 7) { throw 'The manager must offer all seven extension languages' }
    # Exercise the older-Windows outline on a hidden window even when this
    # machine supports DWM rounding. No visible window or real install is used.
    $shapeProbe = $formConstructor.Invoke([object[]]@($backend))
    try {
        [void]$shapeProbe.Handle
        $windowType = $formType.BaseType
        $windowType.GetField('nativeCorners', $flags).SetValue($shapeProbe, $false)
        $updateCorners = $windowType.GetMethod('UpdateWindowCorners', $flags)
        foreach ($dimensions in @((New-Object Drawing.Size(752, 850)), (New-Object Drawing.Size(872, 930)))) {
            $shapeProbe.ClientSize = $dimensions
            $updateCorners.Invoke($shapeProbe, @()) | Out-Null
            if ($null -eq $shapeProbe.Region -or $shapeProbe.Region.IsVisible(0, 0) -or $shapeProbe.Region.IsVisible(($shapeProbe.Width - 1), ($shapeProbe.Height - 1)) -or !$shapeProbe.Region.IsVisible([int]($shapeProbe.Width / 2), [int]($shapeProbe.Height / 2))) { throw 'Rounded outline did not follow window resizing' }
        }
        $shapeProbe.WindowState = [Windows.Forms.FormWindowState]::Maximized
        $updateCorners.Invoke($shapeProbe, @()) | Out-Null
        if ($null -ne $shapeProbe.Region) { throw 'Maximizing left rounded corner cutouts' }
        $shapeProbe.WindowState = [Windows.Forms.FormWindowState]::Normal
        $updateCorners.Invoke($shapeProbe, @()) | Out-Null
        if ($null -eq $shapeProbe.Region -or $shapeProbe.Region.IsVisible(0, 0)) { throw 'Restoring the window did not restore rounded corners' }
        if ($shapeProbe.Visible) { throw 'The geometry probe unexpectedly showed a window' }
    } finally { $shapeProbe.Dispose() }
    foreach ($languageIndex in 0..($languageCodes.Count - 1)) {
        $form = $formConstructor.Invoke([object[]]@($backend))
        try {
            $languageControl = $formType.GetField('language', $flags).GetValue($form)
            $idsControl = $formType.GetField('ids', $flags).GetValue($form)
            $savedIdsText = $idsControl.Text
            $languageControl.SelectedIndex = $languageIndex
            if ($idsControl.Text -ne $savedIdsText) { throw 'Changing language altered the extension IDs' }
            if ($languageControl.ContextMenuStrip.Items.Count -ne 7) { throw 'Language menu is incomplete' }
            $currentLocale = $formType.GetField('locale', $flags).GetValue($form)
            $currentCode = $localeType.GetProperty('Code', $flags).GetValue($currentLocale)
            if ($currentCode -ne $languageCodes[$languageIndex]) { throw 'Selected language was not applied' }
            $termsLink = $formType.GetField('termsLink', $flags).GetValue($form)
            $privacyLink = $formType.GetField('privacyLink', $flags).GetValue($form)
            $repositoryLink = $formType.GetField('repositoryLink', $flags).GetValue($form)
            $termsRelative = if ($currentCode -eq 'en') { 'TERMS.md' } else { 'docs/legal/TERMS.' + $currentCode + '.md' }
            if ($termsLink.Tag -ne ('https://github.com/ShadowsLunarfox/Lunar-Start-Page/blob/main/' + $termsRelative) -or !(Test-Path -LiteralPath (Join-Path $workspace $termsRelative))) { throw ('Wrong terms link: ' + $currentCode) }
            $privacyRelative = if ($currentCode -eq 'en') { 'PRIVACY.md' } else { 'docs/legal/PRIVACY.' + $currentCode + '.md' }
            if ($privacyLink.Tag -ne ('https://github.com/ShadowsLunarfox/Lunar-Start-Page/blob/main/' + $privacyRelative) -or !(Test-Path -LiteralPath (Join-Path $workspace $privacyRelative))) { throw ('Wrong privacy policy link: ' + $currentCode) }
            if ($repositoryLink.Tag -ne 'https://github.com/ShadowsLunarfox/Lunar-Start-Page') { throw 'Wrong repository link' }
            $form.StartPosition = [Windows.Forms.FormStartPosition]::Manual
            $form.Location = New-Object Drawing.Point(-30000, -30000)
            $form.ShowInTaskbar = $false
            $form.Show() # Render our own form off-screen; no desktop UI automation.
            [Windows.Forms.Application]::DoEvents()
            $form.PerformLayout()
            $windowType = $formType.BaseType
            $nativeCorners = [bool]$windowType.GetField('nativeCorners', $flags).GetValue($form)
            if ($nativeCorners -and $null -ne $form.Region) { throw 'A window region disabled native rounded corners' }
            if (!$nativeCorners -and ($null -eq $form.Region -or $form.Region.IsVisible(0, 0) -or !$form.Region.IsVisible([int]($form.Width / 2), [int]($form.Height / 2)))) { throw 'Rounded-window fallback has an invalid outline' }
            $bitmap = New-Object Drawing.Bitmap($form.Width, $form.Height)
            try {
                $form.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
                $previewDirectory = Join-Path $workspace 'dist\manager-preview'
                New-Item -ItemType Directory -Path $previewDirectory -Force | Out-Null
                $bitmap.Save((Join-Path $previewDirectory ($name + '-' + $languageIndex + '.png')), [Drawing.Imaging.ImageFormat]::Png)
                if ($name -eq 'installed' -and $languageIndex -eq 0) {
                    $exeIcon = [Drawing.Icon]::ExtractAssociatedIcon([IO.Path]::GetFullPath($ManagerExecutable))
                    try {
                        $iconBitmap = $exeIcon.ToBitmap()
                        try { $iconBitmap.Save((Join-Path $previewDirectory 'exe-icon.png'), [Drawing.Imaging.ImageFormat]::Png) } finally { $iconBitmap.Dispose() }
                    } finally { $exeIcon.Dispose() }
                }
                $bounds = @('idsLabel', 'ids', 'idsHint', 'pathLabel', 'location', 'notice', 'details') | ForEach-Object {
                    $control = $formType.GetField($_, $flags).GetValue($form)
                    [pscustomobject]@{name=$_; x=$control.Left; y=$control.Top; width=$control.Width; height=$control.Height}
                }
                $bounds | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $previewDirectory ($name + '-' + $languageIndex + '.json')) -Encoding UTF8
                [pscustomobject]@{nativeCorners=$nativeCorners; width=$form.Width; height=$form.Height; clippedRegion=($null -ne $form.Region)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $previewDirectory ($name + '-' + $languageIndex + '-window.json')) -Encoding UTF8
            } finally { $bitmap.Dispose() }
        } finally { $form.Dispose() }
    }
    $reopened = $formConstructor.Invoke([object[]]@($backend))
    try {
        if ($formType.GetField('language', $flags).GetValue($reopened).SelectedIndex -ne ($languageCodes.Count - 1)) { throw 'The selected language was not remembered on reopening' }
    } finally { $reopened.Dispose() }
    if ($name -eq 'installed') {
        $promptType = $assembly.GetType('LunarStart.ConnectorManager.DarkPrompt', $false)
        if ($null -ne $promptType) {
            $localeType.GetMethod('Select', $flags).Invoke($currentLocale, [object[]]@([string]'en', [bool]$false)) | Out-Null
            $translate = $localeType.GetMethod('T', $flags)
            $message = $translate.Invoke($currentLocale, [object[]]@([string]'uninstall_confirm'))
            $title = $translate.Invoke($currentLocale, [object[]]@([string]'uninstall_title'))
            $promptConstructor = $promptType.GetConstructor($flags, $null, [type[]]@([string], [string], [bool], $localeType), $null)
            $prompt = $promptConstructor.Invoke([object[]]@([string]$message, [string]$title, [bool]$true, $currentLocale))
            try {
                $prompt.StartPosition = [Windows.Forms.FormStartPosition]::Manual
                $prompt.Location = New-Object Drawing.Point(-30000, -30000)
                $prompt.Show()
                [Windows.Forms.Application]::DoEvents()
                $bitmap = New-Object Drawing.Bitmap($prompt.Width, $prompt.Height)
                try {
                    $prompt.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $prompt.Width, $prompt.Height)))
                    $bitmap.Save((Join-Path $previewDirectory 'uninstall-dialog.png'), [Drawing.Imaging.ImageFormat]::Png)
                } finally { $bitmap.Dispose() }
            } finally { $prompt.Dispose() }
        }
    }
}
try {
    Assert-State 'NotInstalled'
    Render-Preview 'not-installed'
    if (Test-Path -LiteralPath $installRoot) { throw 'Opening status created an installation' }
    $invalidRejected = $false
    try { Run-Operation $false @("bad'; throw 'must not execute") | Out-Null } catch { $invalidRejected = $_.Exception.Message -like '*32*' }
    if (!$invalidRejected -or (Test-Path -LiteralPath $installRoot)) { throw 'Invalid extension ID was not rejected before changes' }
    $ids = [string[]]@(('a' * 32), ('b' * 32))
    Run-Operation $false $ids | Out-Null # PrepareOnly: real Chrome/Edge registration is never written.
    Assert-State 'NeedsRepair'
    Register-Fixture
    Assert-State 'Installed'
    Render-Preview 'installed'
    if (@(Field (Status) 'ExtensionIds').Count -ne 2) { throw 'Saved IDs were not recovered' }
    $unrelated = Join-Path $installRoot 'user-file.txt'
    [IO.File]::WriteAllText($unrelated, 'keep unrelated user data')
    $manifestPath = Join-Path $installRoot ($hostName + '.json')
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    Remove-Item -LiteralPath $manifest.path
    Assert-State 'NeedsRepair'
    Render-Preview 'needs-repair'
    $savedIds = [string[]](Field (Status) 'ExtensionIds')
    Run-Operation $false $savedIds | Out-Null
    Assert-State 'Installed'
    $badKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($registryPaths[1])
    try { $badKey.SetValue('', 'missing-manifest.json') } finally { $badKey.Dispose() }
    Assert-State 'NeedsRepair'
    Register-Fixture
    Assert-State 'Installed'
    $goodManifest = [IO.File]::ReadAllText($manifestPath)
    [IO.File]::WriteAllText($manifestPath, '{broken json')
    Assert-State 'NeedsRepair'
    [IO.File]::WriteAllText($manifestPath, $goodManifest)
    $manifest.allowed_origins = @('chrome-extension://' + ('c' * 32) + '/')
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    Assert-State 'NeedsRepair'
    [IO.File]::WriteAllText($manifestPath, $goodManifest)
    [IO.File]::AppendAllText($manifest.path, 'tamper')
    Assert-State 'NeedsRepair'
    Run-Operation $false $savedIds | Out-Null
    Assert-State 'Installed'
    $markerPath = Join-Path $installRoot 'installation.json'
    $goodMarker = [IO.File]::ReadAllText($markerPath)
    $marker = $goodMarker | ConvertFrom-Json
    $marker.files += '..\do-not-delete.txt'
    $outside = Join-Path (Split-Path -Parent $installRoot) 'do-not-delete.txt'
    [IO.File]::WriteAllText($outside, 'keep this too')
    $marker | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $markerPath -Encoding UTF8
    Assert-State 'NeedsRepair'
    $unsafeRejected = $false
    try { Run-Operation $true @() | Out-Null } catch { $unsafeRejected = $_.Exception.Message -like '*Unsafe owned-file entry*' }
    if (!$unsafeRejected -or !(Test-Path -LiteralPath $outside) -or !(Test-Path -LiteralPath $manifest.path)) { throw 'Unsafe ownership did not fail before removal' }
    [IO.File]::WriteAllText($markerPath, $goodMarker)
    Run-Operation $true @() | Out-Null
    # Uninstall.ps1 deliberately ignores our separate fixture registrations.
    Assert-State 'NeedsRepair'
    foreach ($path in $registryPaths) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($path, $false) }
    Assert-State 'NotInstalled'
    Run-Operation $true @() | Out-Null
    Assert-State 'NotInstalled'
    if (!(Test-Path -LiteralPath $unrelated) -or !(Test-Path -LiteralPath $outside)) { throw 'Unrelated files were removed' }
    for ($i = 0; $i -lt $productionPaths.Count; $i++) {
        if ((Read-Registration $productionPaths[$i]) -ne $originalRegistrations[$i]) { throw 'A real browser registration changed' }
    }
    Write-Output 'PASS: standalone embedded payload; read-only status; invalid-ID rejection; missing files, corrupt manifest, wrong origins, hash mismatch and registration checks; repair with saved IDs; ownership protection; repeat uninstall and unrelated-file preservation. Preview mode also checks native/fallback rounded corners, resize/maximize/restore, all seven languages and localized privacy/terms/repository links. Real Chrome/Edge registrations were not changed.'
} finally {
    if (!$registryRoot.StartsWith('Software\LunarStart\ManagerTests\', [StringComparison]::Ordinal)) { throw 'Unsafe fixture registry cleanup' }
    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($registryRoot, $false)
    # Keep isolated file fixtures for inspection; never recursively remove a computed install path.
}
