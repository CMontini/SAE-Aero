$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$test = Join-Path $env:TEMP ('AeroVaultAssemblyTests-' + [Guid]::NewGuid().ToString('N') + '.exe')
try {
    & $compiler /nologo /target:exe /platform:anycpu /langversion:5 ("/out:" + $test) /reference:System.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll (Join-Path $PSScriptRoot '..\AeroVault.AddIn\AssemblyManifest.cs') (Join-Path $PSScriptRoot 'AssemblyManifestTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Assembly manifest test compilation failed.' }
    & $test
    if ($LASTEXITCODE -ne 0) { throw 'Assembly manifest tests failed.' }
} finally { if (Test-Path $test) { Remove-Item $test } }
