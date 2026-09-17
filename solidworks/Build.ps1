param([string]$SolidWorksDirectory)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$buildMarker = Join-Path $PSScriptRoot 'bin\build.ok'
if (Test-Path $buildMarker) { Remove-Item $buildMarker }
if (-not [Environment]::Is64BitOperatingSystem) { throw '64-bit Windows is required.' }
if (Get-Process SLDWORKS -ErrorAction SilentlyContinue) { throw 'Close SOLIDWORKS before building or installing the add-in.' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $compiler)) { throw '.NET Framework 4.8 with its C# compiler is required.' }

if (-not $SolidWorksDirectory) {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'SOLIDWORKS Corp\SOLIDWORKS'),
        (Join-Path $env:ProgramFiles 'SOLIDWORKS Corp\SOLIDWORKS 2026'),
        (Join-Path $env:ProgramFiles 'SOLIDWORKS 2026\SOLIDWORKS')
    )
    $SolidWorksDirectory = $candidates | Where-Object { Test-Path (Join-Path $_ 'api\redist\SolidWorks.Interop.sldworks.dll') } | Select-Object -First 1
}
if (-not $SolidWorksDirectory) { throw 'Could not locate SOLIDWORKS. Run .\Build.ps1 -SolidWorksDirectory "C:\path\to\SOLIDWORKS" (the folder containing SLDWORKS.exe).' }
$interop = Join-Path $SolidWorksDirectory 'api\redist'
$interopNames = @('SolidWorks.Interop.sldworks.dll', 'SolidWorks.Interop.swconst.dll', 'SolidWorks.Interop.swpublished.dll')
foreach ($name in $interopNames) {
    if (-not (Test-Path (Join-Path $interop $name))) { throw "Missing SOLIDWORKS API assembly: $interop\$name" }
}

# Download only the public Microsoft SDK. The installed Evergreen Runtime is separate.
$sdkVersion = '1.0.3405.78'
$cache = Join-Path $PSScriptRoot '.packages'
$sdk = Join-Path $cache "Microsoft.Web.WebView2.$sdkVersion"
$sdkMarker = Join-Path $sdk '.complete'
New-Item -ItemType Directory -Force -Path $cache | Out-Null
if (-not (Test-Path $sdkMarker)) {
    if (Test-Path $sdk) { Remove-Item $sdk -Recurse -Force }
    $archive = Join-Path $cache 'webview2.zip'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/microsoft.web.webview2.$sdkVersion.nupkg" -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $sdk
    Remove-Item $archive
    New-Item -ItemType File -Path $sdkMarker | Out-Null
}
$output = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$frameworkReferences = @('System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Web.Extensions.dll', 'System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll')
$references = @($frameworkReferences | ForEach-Object { '/reference:' + $_ })
foreach ($name in $interopNames) { $references += '/reference:' + (Join-Path $interop $name) }
foreach ($name in @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll')) {
    $path = Join-Path $sdk "lib\net462\$name"
    if (-not (Test-Path $path)) { throw "Missing WebView2 SDK assembly: $path" }
    $references += '/reference:' + $path
    Copy-Item $path $output -Force
}
Copy-Item (Join-Path $sdk 'runtimes\win-x64\native\WebView2Loader.dll') $output -Force
foreach ($name in $interopNames) { Copy-Item (Join-Path $interop $name) $output -Force }
$sources = @(Get-ChildItem (Join-Path $PSScriptRoot 'AeroVault.AddIn\*.cs') | ForEach-Object { $_.FullName })
# Managed AnyCPU code loads into SOLIDWORKS's 64-bit process; the WebView2 loader is x64.
& $compiler /nologo /target:library /platform:anycpu /optimize+ /langversion:5 ("/out:" + (Join-Path $output 'AeroVault.AddIn.dll')) @references @sources
if ($LASTEXITCODE -ne 0) { throw 'Add-in compilation failed. Copy the compiler errors when reporting the failure.' }

# Exercise the actual ZIP extractor on this Windows runtime before installing.
$test = Join-Path $output 'ArchiveTests.exe'
& $compiler /nologo /target:exe /platform:anycpu /langversion:5 ("/out:" + $test) /reference:System.dll /reference:System.Core.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll (Join-Path $PSScriptRoot 'AeroVault.AddIn\SafeArchive.cs') (Join-Path $PSScriptRoot 'tests\ArchiveTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Archive test compilation failed.' }
& $test
if ($LASTEXITCODE -ne 0) { throw 'Archive safety tests failed. Do not install this build.' }

# Verify actual COM interface exposure before another SOLIDWORKS load attempt.
$callbackTest = Join-Path $output 'CallbackTests.exe'
& $compiler /nologo /target:exe /platform:anycpu /langversion:5 ("/out:" + $callbackTest) /reference:System.dll ("/reference:" + (Join-Path $output 'AeroVault.AddIn.dll')) ("/reference:" + (Join-Path $output 'SolidWorks.Interop.swpublished.dll')) (Join-Path $PSScriptRoot 'tests\CallbackTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Callback test compilation failed.' }
& $callbackTest
if ($LASTEXITCODE -ne 0) { throw 'COM callback interface tests failed. Do not install this build.' }
$syncTest = Join-Path $output 'SyncStateTests.exe'
& $compiler /nologo /target:exe /platform:anycpu /langversion:5 ("/out:" + $syncTest) /reference:System.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'AeroVault.AddIn\SyncState.cs') (Join-Path $PSScriptRoot 'tests\SyncStateTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Sync state test compilation failed.' }
& $syncTest
if ($LASTEXITCODE -ne 0) { throw 'Sync state tests failed. Do not install this build.' }
Set-Content -LiteralPath $buildMarker -Value 'Build and all Windows tests passed.'
Write-Host "Build and all Windows tests passed. Next run Install.ps1 from Windows PowerShell as administrator. Output: $output"
