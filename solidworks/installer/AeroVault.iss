#ifndef AppVersion
  #define AppVersion "0.3.1"
#endif

[Setup]
AppId={{DCBF5D69-BA26-4A5A-9758-36FA29126C29}
AppName=Aero Vault for SOLIDWORKS
AppVersion={#AppVersion}
AppPublisher=SAE Aero Team
AppPublisherURL=https://github.com/CMontini/SAE-Aero
AppSupportURL=https://github.com/CMontini/SAE-Aero/issues
DefaultDirName={commonpf64}\AeroVault2026
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir=output
OutputBaseFilename=AeroVault-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
CloseApplications=no
RestartApplications=no
UninstallDisplayName=Aero Vault for SOLIDWORKS
UninstallDisplayIcon={app}\AeroVault.AddIn.dll

[Files]
Source: "stage\payload.zip"; Flags: dontcopy
Source: "stage\Prepare-Install.ps1"; Flags: dontcopy
Source: "stage\MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy
; Prepared and tested before installation begins. Only these DLLs are installed.
Source: "{tmp}\payload\bin\Microsoft.Web.WebView2.Core.dll"; DestDir: "{app}"; ExternalSize: 1048576; Flags: external ignoreversion
Source: "{tmp}\payload\bin\Microsoft.Web.WebView2.WinForms.dll"; DestDir: "{app}"; ExternalSize: 1048576; Flags: external ignoreversion
Source: "{tmp}\payload\bin\WebView2Loader.dll"; DestDir: "{app}"; ExternalSize: 1048576; Flags: external ignoreversion
Source: "{tmp}\payload\bin\SolidWorks.Interop.sldworks.dll"; DestDir: "{app}"; ExternalSize: 1048576; Flags: external ignoreversion
Source: "{tmp}\payload\bin\SolidWorks.Interop.swconst.dll"; DestDir: "{app}"; ExternalSize: 1048576; Flags: external ignoreversion
Source: "{tmp}\payload\bin\SolidWorks.Interop.swpublished.dll"; DestDir: "{app}"; ExternalSize: 1048576; Flags: external ignoreversion
Source: "{tmp}\payload\bin\AeroVault.AddIn.dll"; DestDir: "{app}"; ExternalSize: 1048576; Flags: external ignoreversion; AfterInstall: RegisterAddIn

[Icons]
Name: "{commonprograms}\Aero Vault\Workspace"; Filename: "https://aero-vault.carson-montini.chatgpt.site"

[Messages]
FinishedLabel=Setup installed Aero Vault. Start SOLIDWORKS normally, open Tools > Add-Ins, and enable Aero Vault (and Start Up if desired). Open the A Task Pane tab and sign in with your authorized team account.

[Code]
var
  SolidWorksPage: TInputDirWizardPage;

function SolidWorksRunning: Boolean;
var Locator, Services, Processes: Variant;
begin
  // Fail closed if process enumeration is unavailable; never replace loaded DLLs.
  Result := True;
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Services := Locator.ConnectServer('', 'root\CIMV2');
    Processes := Services.ExecQuery('SELECT ProcessId FROM Win32_Process WHERE Name = ''SLDWORKS.exe''');
    Result := Processes.Count > 0;
  except
    Log('Could not check whether SOLIDWORKS is running.');
  end;
end;

function FindSolidWorks: String;
var Candidate: String;
begin
  Result := '';
  if RegQueryStringValue(HKLM64, 'SOFTWARE\SOLIDWORKS\SOLIDWORKS 2026\Setup', 'SolidWorks Folder', Candidate) then
    if FileExists(AddBackslash(Candidate) + 'SLDWORKS.exe') then begin Result := Candidate; exit; end;
  Candidate := ExpandConstant('{commonpf64}\SOLIDWORKS Corp\SOLIDWORKS');
  if FileExists(Candidate + '\SLDWORKS.exe') then begin Result := Candidate; exit; end;
  Candidate := ExpandConstant('{commonpf64}\SOLIDWORKS Corp\SOLIDWORKS 2026');
  if FileExists(Candidate + '\SLDWORKS.exe') then begin Result := Candidate; exit; end;
  Candidate := ExpandConstant('{commonpf64}\SOLIDWORKS 2026\SOLIDWORKS');
  if FileExists(Candidate + '\SLDWORKS.exe') then Result := Candidate;
end;

procedure InitializeWizard;
begin
  SolidWorksPage := CreateInputDirPage(wpWelcome, 'Locate SOLIDWORKS 2026',
    'Confirm your SOLIDWORKS installation folder.',
    'Choose the folder containing SLDWORKS.exe. Aero Vault uses your installed SOLIDWORKS API. Close SOLIDWORKS before continuing.', False, '');
  SolidWorksPage.Add('SOLIDWORKS folder:');
  SolidWorksPage.Values[0] := ExpandConstant('{param:SOLIDWORKSDIR|' + FindSolidWorks + '}');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = SolidWorksPage.ID) and FileExists(AddBackslash(SolidWorksPage.Values[0]) + 'SLDWORKS.exe');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = SolidWorksPage.ID) and not WizardSilent then begin
    Result := FileExists(AddBackslash(SolidWorksPage.Values[0]) + 'SLDWORKS.exe');
    if not Result then MsgBox('Select the folder containing SLDWORKS.exe.', mbError, MB_OK);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var ExitCode: Integer; Parameters: String;
begin
  Result := '';
  if SolidWorksRunning then begin Result := 'Close SOLIDWORKS, then select Retry.'; exit; end;
  if not FileExists(AddBackslash(SolidWorksPage.Values[0]) + 'SLDWORKS.exe') then begin
    Result := 'SOLIDWORKS was not found. Install SOLIDWORKS 2026 first, then run Aero Vault Setup again.'; exit;
  end;
  if Pos('"', SolidWorksPage.Values[0]) > 0 then begin Result := 'Invalid SOLIDWORKS folder.'; exit; end;
  WizardForm.PreparingLabel.Caption := 'Preparing Aero Vault and checking prerequisites. This may take a few minutes.';
  ExtractTemporaryFile('payload.zip');
  ExtractTemporaryFile('Prepare-Install.ps1');
  ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
  Parameters := '-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "' + ExpandConstant('{tmp}\Prepare-Install.ps1') + '" -SolidWorksDirectory "' + RemoveBackslashUnlessRoot(SolidWorksPage.Values[0]) + '"';
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Parameters, '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
    Result := 'Windows could not start the Aero Vault prerequisite check.'
  else if ExitCode <> 0 then
    Result := 'Aero Vault could not finish preparing. See C:\ProgramData\AeroVault\Installer\setup.log for details. Your previous installation has not been replaced.';
end;

procedure RegisterAddIn;
var ExitCode: Integer;
begin
  if not Exec(ExpandConstant('{win}\Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe'),
    '"' + ExpandConstant('{app}\AeroVault.AddIn.dll') + '" /codebase /nologo', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
    RaiseException('Windows could not register Aero Vault.');
  if ExitCode <> 0 then RaiseException('Aero Vault registration failed. Keep the Setup log and report the error.');
end;

function InitializeUninstall: Boolean;
begin
  Result := not SolidWorksRunning;
  if not Result then SuppressibleMsgBox('Close SOLIDWORKS before uninstalling Aero Vault.', mbError, MB_OK, IDOK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var ExitCode: Integer;
begin
  if CurUninstallStep = usUninstall then begin
    if not Exec(ExpandConstant('{win}\Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe'),
      '"' + ExpandConstant('{app}\AeroVault.AddIn.dll') + '" /unregister /nologo', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
      RaiseException('Could not unregister Aero Vault. Installation files were kept.');
    if ExitCode <> 0 then RaiseException('Could not unregister Aero Vault. Installation files were kept.');
  end;
end;
