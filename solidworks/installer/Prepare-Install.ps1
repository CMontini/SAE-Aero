param([Parameter(Mandatory=$true)][string]$SolidWorksDirectory)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$logDirectory = Join-Path $env:ProgramData 'AeroVault\Installer'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$log = Join-Path $logDirectory 'setup.log'
Start-Transcript -Path $log -Force | Out-Null
try {
    if (Get-Process SLDWORKS -ErrorAction SilentlyContinue) { throw 'Close SOLIDWORKS before installing Aero Vault.' }
    $release = Get-ItemPropertyValue 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -Name Release -ErrorAction SilentlyContinue
    if (-not $release -or $release -lt 528040) { throw 'Install Microsoft .NET Framework 4.8 or later, restart Windows, and run Setup again.' }
    if (-not (Test-Path -LiteralPath (Join-Path $SolidWorksDirectory 'SLDWORKS.exe'))) { throw 'Select the SOLIDWORKS folder containing SLDWORKS.exe.' }
    $payload = Join-Path $PSScriptRoot 'payload'
    if (Test-Path $payload) { Remove-Item -LiteralPath $payload -Recurse -Force }
    Expand-Archive -LiteralPath (Join-Path $PSScriptRoot 'payload.zip') -DestinationPath $payload
    # Build against the user's installed API, and run the actual Windows tests
    # before Setup changes the existing installation. SDK files are bundled.
    & (Join-Path $payload 'Build.ps1') -SolidWorksDirectory $SolidWorksDirectory
    if (-not (Test-Path (Join-Path $payload 'bin\build.ok'))) { throw 'The add-in did not pass its Windows tests.' }
    $view = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry32)
    function Test-WebViewRuntime {
        $key = $view.OpenSubKey('SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')
        if (-not $key) { return $false }
        try { $version = [string]$key.GetValue('pv'); return ($version -and $version -ne '0.0.0.0') } finally { $key.Dispose() }
    }
    try {
        if (-not (Test-WebViewRuntime)) {
            $bootstrapper = Join-Path $PSScriptRoot 'MicrosoftEdgeWebview2Setup.exe'
            $signature = Get-AuthenticodeSignature -FilePath $bootstrapper
            if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'The Microsoft WebView2 installer signature could not be verified.' }
            $process = Start-Process -FilePath $bootstrapper -ArgumentList '/silent /install' -Wait -PassThru
            if ($process.ExitCode -ne 0 -or -not (Test-WebViewRuntime)) { throw 'WebView2 could not be installed. Check your internet connection, install Microsoft Edge WebView2 Runtime, and retry Setup.' }
        }
    } finally { $view.Dispose() }
    Write-Output 'Aero Vault is ready to install.'
} catch {
    Write-Output $_.Exception.ToString()
    exit 1
} finally { Stop-Transcript | Out-Null }
