param([string]$Version = '0.3.1')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Use a numeric major.minor.patch version.' }
$root = Split-Path $PSScriptRoot -Parent
$stage = Join-Path $PSScriptRoot 'stage'
$payload = Join-Path $stage 'payload'
if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $payload | Out-Null
Copy-Item (Join-Path $root 'Build.ps1') $payload
Copy-Item (Join-Path $root 'AeroVault.AddIn') $payload -Recurse
Copy-Item (Join-Path $root 'tests') $payload -Recurse
Copy-Item (Join-Path $PSScriptRoot 'Prepare-Install.ps1') $stage
$sdkVersion = '1.0.3405.78'
$sdk = Join-Path $payload ".packages\Microsoft.Web.WebView2.$sdkVersion"
$archive = Join-Path $stage 'sdk.zip'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -UseBasicParsing -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/microsoft.web.webview2.$sdkVersion.nupkg" -OutFile $archive
Expand-Archive -LiteralPath $archive -DestinationPath $sdk
foreach ($name in @('lib\net462\Microsoft.Web.WebView2.Core.dll', 'lib\net462\Microsoft.Web.WebView2.WinForms.dll', 'runtimes\win-x64\native\WebView2Loader.dll')) {
    if (-not (Test-Path (Join-Path $sdk $name))) { throw "WebView2 SDK is incomplete: $name" }
}
New-Item -ItemType File -Path (Join-Path $sdk '.complete') | Out-Null
# Use Get-ChildItem -Force so the .packages directory is always included.
Get-ChildItem -LiteralPath $payload -Force | Compress-Archive -DestinationPath (Join-Path $stage 'payload.zip')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $stage 'payload.zip'))
try {
    $entries = @($zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    foreach ($required in @('Build.ps1', 'AeroVault.AddIn/AddIn.cs', 'tests/CallbackTests.cs', ".packages/Microsoft.Web.WebView2.$sdkVersion/.complete", ".packages/Microsoft.Web.WebView2.$sdkVersion/lib/net462/Microsoft.Web.WebView2.Core.dll")) {
        if ($entries -notcontains $required) { throw "Installer payload is missing $required" }
    }
} finally { $zip.Dispose() }
$bootstrapper = Join-Path $stage 'MicrosoftEdgeWebview2Setup.exe' 
Invoke-WebRequest -UseBasicParsing -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrapper
$signature = Get-AuthenticodeSignature -FilePath $bootstrapper
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'Invalid Microsoft bootstrapper signature.' }
$compiler = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'
if (-not (Test-Path $compiler)) { throw 'Install Inno Setup 6 before building the installer.' }
& $compiler "/DAppVersion=$Version" (Join-Path $PSScriptRoot 'AeroVault.iss')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
$output = Join-Path $PSScriptRoot "output\AeroVault-Setup-$Version.exe"
if (-not (Test-Path $output)) { throw 'Installer output was not created.' }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$output.sha256" -Encoding ASCII -Value "$hash  $(Split-Path $output -Leaf)"
Write-Output "Installer: $output"
