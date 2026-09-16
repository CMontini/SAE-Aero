$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Open Windows PowerShell as administrator for this registration step, then run Install.ps1 again.' }
if (Get-Process SLDWORKS -ErrorAction SilentlyContinue) { throw 'Close SOLIDWORKS before installation.' }
$source = Join-Path $PSScriptRoot 'bin'
if (-not (Test-Path (Join-Path $source 'build.ok'))) { throw 'Run Build.ps1 and wait for the build and archive tests to pass first.' }
$names = @('AeroVault.AddIn.dll', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll', 'SolidWorks.Interop.sldworks.dll', 'SolidWorks.Interop.swconst.dll', 'SolidWorks.Interop.swpublished.dll')
foreach ($name in $names) { if (-not (Test-Path (Join-Path $source $name))) { throw "Missing $name. Run Build.ps1 successfully first." } }
$destination = Join-Path $env:ProgramFiles 'AeroVault2026'
$regasm = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe'
if (-not (Test-Path $regasm)) { throw '.NET Framework 64-bit RegAsm is missing.' }
New-Item -ItemType Directory -Force -Path $destination | Out-Null
foreach ($name in $names) { Copy-Item (Join-Path $source $name) $destination -Force }
Copy-Item (Join-Path $PSScriptRoot 'Uninstall.ps1') $destination -Force
& $regasm (Join-Path $destination 'AeroVault.AddIn.dll') /codebase /nologo
if ($LASTEXITCODE -ne 0) { throw 'COM registration failed. Copy the error output when reporting the failure.' }
Write-Host 'Registered Aero Vault. Close this administrator window. Start SOLIDWORKS normally, then Tools > Add-Ins > Aero Vault.'
