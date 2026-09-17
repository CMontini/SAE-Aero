# Aero Vault inside SOLIDWORKS — pilot 0.3

Aero Vault now updates a linked design after you save it in SOLIDWORKS. Manual checkout and check-in buttons have been replaced by automatic editing sessions and an **Editing by…** status.

The workspace is https://aero-vault.carson-montini.chatgpt.site. Install this update on every computer using the add-in. Older add-ins can browse and upload a first package, but need this update for automatic editing and saves.

## Daily workflow

1. **New design:** save the design and linked parts in SOLIDWORKS. In the panel choose **Upload package → Use active SolidWorks design**, choose a subsystem, and upload once. That links this exact local design to its cloud package. Selecting a ZIP through the ordinary file picker does not create a native link.
2. **Existing package:** choose **Open for editing** in the panel. Choose the top-level assembly if asked. Aero Vault downloads into a new local folder, links it, and shows your name as the editor.
3. **Save normally:** save the model and all modified linked parts. After a short settling delay, the add-in creates a Pack and Go snapshot and uploads a revision automatically. Rapid consecutive saves can be combined. Keep the design and SOLIDWORKS open until the panel says **Saved to Aero Vault · revision …**.
4. **Close the design:** editing presence clears automatically. If SOLIDWORKS crashes or goes offline, presence expires after about two minutes without a heartbeat. The website refreshes status about every ten seconds.

One person edits each package at a time; other teammates can open a read-only copy. This is automatic session coordination, not simultaneous CAD geometry merging. It also prevents two computers signed into the same account from silently replacing one another's work.

## Install or update in Windows

Use Windows inside Parallels. Close SOLIDWORKS before building or installing. Prefer a folder on the local Windows drive, such as `C:\Users\YOUR_NAME\Downloads\SAE-Aero-main`, instead of a shared Mac/network folder.

1. Download the latest ZIP from [CMontini/SAE-Aero](https://github.com/CMontini/SAE-Aero) using **Code → Download ZIP**. In Windows Explorer, open its Properties and select **Unblock** if shown, then extract it. Open Windows PowerShell and change to the extracted `solidworks` folder.
2. Run in normal Windows PowerShell:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\Build.ps1
   ```

   If your installation is not detected, append `-SolidWorksDirectory "C:\path\to\SOLIDWORKS"`, pointing to the folder containing `SLDWORKS.exe`.
3. Continue only after **Build and all Windows tests passed**. Open Windows PowerShell **as administrator**, change to the same `solidworks` folder, and run:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\Install.ps1
   ```

4. Close the administrator window. Start SOLIDWORKS normally, enable **Tools → Add-Ins → Aero Vault**, and open the **A** Task Pane tab. Sign in with the account used for the website. If you previously enabled startup, a normal full restart loads the updated DLL.

Requirements: SOLIDWORKS 2026 Student Edition, installed SOLIDWORKS API interop assemblies, .NET Framework 4.8+, and [Microsoft Edge WebView2 Evergreen Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) in Windows. The build downloads the pinned public Microsoft WebView2 SDK from NuGet. It uses the installed compiler and runs ZIP, callback-interface, and local sync-state tests before permitting installation. It does not change machine execution policy.

The source includes the explicit IDispatch callback fix that allowed the prior add-in to load on the owner's Parallels installation. The 0.3 native save watcher and Pack and Go flow still need Windows/SOLIDWORKS verification. They cannot be executed in the Linux authoring environment. [SOLIDWORKS requirements](https://www.solidworks.com/support/system-requirements) list x86-64 processors; the observed working installation does not establish support for every Windows-on-ARM/Parallels setup.

## Offline saves and conflicts

- A saved snapshot is written to a local outbox before upload. Its operation ID stays the same across retries and restarts, so a lost server response does not create repeated revisions.
- New changes made while an older snapshot uploads are detected afterward and queued separately. Your disk files are never overwritten by a background cloud update.
- Missing references, unsaved linked parts, oversized packages, or a newer cloud revision stop that upload and show a status message. Save the linked parts or resolve the displayed issue.
- If you close a design before its snapshot is created, its saved disk changes remain detectable. Reopen that exact local file to resume. A closed file cannot be repackaged by this pilot without reopening it.
- A revision conflict keeps the local copy and queued ZIP. Use **Disconnect local copy** in the sync warning when you want to keep that copy separately and open the latest cloud revision. Disconnecting asks for confirmation, ends your editing session, and preserves CAD files and the queued ZIP. Reconcile the design manually before uploading a replacement revision; no automatic merge is attempted.
- **Save As** to a different path requires an explicit new link/upload. Renaming does not silently overwrite the original package.
- Designs made before this update have no saved native mapping. Open them through **Open for editing**, or upload/link the active design once. Filenames alone are never used to guess the cloud package.
- Packages remain independent. Shared parts across separate packages require team coordination.

## Test before team use

1. Upload/link a disposable saved part. Change a dimension and save. Verify that a new revision appears automatically and that the earlier revision can still be downloaded.
2. Make two saves while a transfer is in progress. Verify the final cloud revision contains the later change.
3. Close the part and verify editing status clears. Reopen the exact local file and verify your name reappears.
4. Temporarily disconnect the network, save, and wait for a queued status. Reconnect and verify the save is acknowledged. Restart with a queued snapshot and confirm it is recovered.
5. Test a small assembly with linked parts in separate folders. Save all modified parts and the assembly; reopen the downloaded revision and verify references and geometry. Close original same-named components before opening a downloaded copy so SOLIDWORKS does not reuse originals already in memory.
6. With two authorized accounts, verify a second editor sees the first editor's name and can open read-only; stale local changes must not replace newer cloud work.

The backend tests exercise session contention/expiry, mid-upload session changes, stale revisions, retries after a lost response, history preservation, and role checks with actual SQLite and an isolated object-store adapter. Those tests do not replace a real SolidWorks assembly round trip.

## Local files and removal

- Installed DLLs: `C:\Program Files\AeroVault2026`.
- Downloaded design copies: `%LOCALAPPDATA%\AeroVault\Downloads`.
- Queued snapshots: `%LOCALAPPDATA%\AeroVault\Staging`. Do not clear this folder while uploads are pending.
- Durable design mappings and outbox metadata: `%LOCALAPPDATA%\AeroVault\AutoSync\links.json` (with an atomic-write backup). Each mapping is tied to its signed-in account. One SOLIDWORKS process per Windows session owns automatic sync.
- Browser profile: `%LOCALAPPDATA%\AeroVault\WebView2`.
- Startup diagnostics: `%LOCALAPPDATA%\AeroVault\Logs\startup-error.txt`.

Uploads remain limited to 50 MB, ZIP extraction to 5,000 entries and 512 MB expanded. The add-in packages drawings and suppressed components, excludes simulation results, and preserves the Pack and Go folder structure. Only the exact Aero Vault HTTPS origin can use the native bridge. All cloud changes use the existing signed-in website and server role checks. No cookies, passwords, or hosting bypass tokens are exported.

To disable, uncheck Aero Vault in Tools → Add-Ins. To uninstall, close SOLIDWORKS and run `Uninstall.ps1` as administrator. Local CAD files, queued saves, sign-in profile, and cloud history are preserved. The site remains owner-private until its sharing settings authorize teammates in addition to app membership.
