$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this script in Windows PowerShell as administrator.' }
if (Get-Process SLDWORKS -ErrorAction SilentlyContinue) { throw 'Close SOLIDWORKS first.' }
$destination = Join-Path $env:ProgramFiles 'AeroVault2026'
$assembly = Join-Path $destination 'AeroVault.AddIn.dll'
if (Test-Path $assembly) {
    $regasm = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe'
    & $regasm $assembly /unregister /nologo
    if ($LASTEXITCODE -ne 0) { throw 'Unregistration failed; installation files were kept.' }
    # Remove only files installed by this pilot, never design downloads or browser data.
    foreach ($name in @('AeroVault.AddIn.dll', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll', 'SolidWorks.Interop.sldworks.dll', 'SolidWorks.Interop.swconst.dll', 'SolidWorks.Interop.swpublished.dll', 'Uninstall.ps1')) {
        $path = Join-Path $destination $name
        if (Test-Path $path) { Remove-Item -LiteralPath $path }
    }
}
Write-Host 'Aero Vault unregistered. Local design downloads, sign-in profile, and cloud revisions were kept.'
