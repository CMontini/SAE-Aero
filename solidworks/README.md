# Aero Vault inside SOLIDWORKS — pilot 0.2

This adds an Aero Vault tab to the SOLIDWORKS Task Pane. It uses your existing cloud workspace, login, packages, checkout, and revision history. The browser app remains available at https://aero-vault.carson-montini.chatgpt.site.

**Status:** source pilot targeting SOLIDWORKS 2026 Student Edition on Windows. The website bridge passes its automated transfer tests and TypeScript check. The native C# add-in and PowerShell installer have not been compiled or run in SOLIDWORKS by the authoring environment. Build, load, embedded sign-in, Pack and Go, and assembly reopening must be verified on your Windows installation before team use. No prebuilt DLL or signed installer is included.

## What it does

- Shows the existing authenticated workspace inside SOLIDWORKS.
- Adds **Use active SolidWorks design** to Upload package and Check in revision. It asks SOLIDWORKS to create a Pack and Go ZIP of the saved active document, with drawings and suppressed components included. Simulation results are excluded. You review the filename and change note before uploading.
- Adds **Open in SolidWorks** to a package. It downloads into a new local folder, extracts ZIPs, and asks you to select the top-level assembly when there are multiple CAD files.
- Opens the latest revision for editing when the panel shows your checkout. Other downloads open read-only. Server-side checkout rules still decide whether a new revision can be uploaded.
- Keeps previous cloud revisions intact. It does not automatically sync on Save, upload silently, or map one local file to a cloud package.

## Before installing in Parallels

Run every step **inside Windows**, with SOLIDWORKS 2026 already installed. Put the extracted repository on a local Windows drive (for example, `C:\Users\YOUR_NAME\Downloads\SAE-Aero-main`), rather than a Parallels shared Mac folder.

[SOLIDWORKS system requirements](https://www.solidworks.com/support/system-requirements) list x86-64 processors and a Parallels version for 2026. That does not establish support for every Mac or Windows-on-ARM configuration. The add-in uses an x64 WebView2 loader because it runs inside SOLIDWORKS's 64-bit process. Loading in your particular Parallels VM remains a test gate.

You need:

- Windows .NET Framework 4.8 or later, normally present on Windows 11.
- The installed SOLIDWORKS API interop DLLs (`api\redist` under the SOLIDWORKS installation).
- [Microsoft Edge WebView2 Evergreen Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/), installed in Windows. This is separate from the SDK downloaded during the build.
- Internet access to NuGet for the public Microsoft WebView2 SDK and to your Aero Vault workspace.
- Windows administrator rights for the registration step only. Start SOLIDWORKS as your normal user afterward.

## Build and install

1. On [the repository](https://github.com/CMontini/SAE-Aero), choose **Code → Download ZIP**. In Windows Explorer, right-click the downloaded ZIP → **Properties** → **Unblock**, if shown, then extract it. Open the extracted `solidworks` folder.
2. Open **Windows PowerShell** (the Windows built-in app). Change to that folder; replace the example path with your actual one:

   ```powershell
   cd "$env:USERPROFILE\Downloads\SAE-Aero-main\solidworks"
   powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\Build.ps1
   ```

   This uses the installed .NET compiler, downloads Microsoft WebView2 SDK 1.0.3405.78 from NuGet, builds the DLL, and runs Windows ZIP safety tests. It does not register anything. Continue only after **Build and archive tests passed**. If SOLIDWORKS is in a different folder:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\Build.ps1 -SolidWorksDirectory "C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS"
   ```

3. Close SOLIDWORKS. Open **Windows PowerShell → Run as administrator**, change to the same folder, and run:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\Install.ps1
   ```

   This copies the add-in and runtime dependencies into `C:\Program Files\AeroVault2026`, registers its COM class, and adds its SOLIDWORKS Add-Ins entry. The pilot DLL is unsigned; RegAsm may warn about `/codebase` on an unsigned assembly. A nonzero exit is a failure. The command's execution policy applies only to that PowerShell process; it does not change machine policy. Do not bypass an organization-managed script restriction.

4. Close the administrator window. Start SOLIDWORKS normally. Open **Tools → Add-Ins**, enable **Aero Vault** under Active Add-ins, and select its **A** tab in the right Task Pane. Leave automatic startup unchecked for the first test.
5. Sign in with the same account you use for the website. The embedded panel has its own normal browser session. If embedded sign-in is refused or loops, stop that test and send the visible error; **Open in browser** still opens the existing working web app, but does not transfer its session into the add-in.

If compilation fails, copy the error lines and the output of `$env:PROCESSOR_ARCHITECTURE` from Windows PowerShell. Do not send credentials, cookies, or tokens.

## First test: use a disposable design

1. Create and save a simple part in a new Windows folder. Save all other open documents too.
2. In Aero Vault, choose **Upload package → Use active SolidWorks design**. Confirm the ZIP filename, add a note, and upload it. Confirm revision 1 also appears in the website.
3. Close the original part. Check out that package and choose **Open in SolidWorks**. Make a small edit, save, and use **Check in revision → Use active SolidWorks design**. Confirm revision 2 and that revision 1 can still be downloaded.
4. Repeat with a small assembly and linked parts in separate subfolders. Close all originals before opening the downloaded copy. Choose its top-level assembly and verify that no references are missing and that its components resolve inside the new download folder.
5. Check read-only opening when there is no checkout. Then test two accounts after both accounts have site access and app membership: a second editor must be blocked from uploading against your checkout.

Save events do not upload automatically. Before each check-in, confirm that the active document belongs to the selected cloud package. The pilot does not detect a mistakenly selected design.

## Local files, boundaries, and removal

- Downloads: `%LOCALAPPDATA%\AeroVault\Downloads`. Every download gets a separate folder; existing design files are not overwritten. Close all originals before opening a downloaded assembly to avoid SOLIDWORKS reusing same-named components already open in memory.
- Temporary Pack and Go files: `%LOCALAPPDATA%\AeroVault\Staging`; removed after transfer or failure when possible.
- Embedded browser profile: `%LOCALAPPDATA%\AeroVault\WebView2`. It stays local. The add-in does not export cookies or accept a hosting bypass token.
- Limit: 50 MB per ZIP/download, 5,000 ZIP entries, 512 MB unpacked. ZIP paths are validated before writing. Cleanup removes the new extraction folder if extraction fails.
- Native messages are accepted only from the exact Aero Vault HTTPS origin. The bridge exposes packaging and revision opening, with no general shell execution or unrestricted filesystem API. New cloud uploads still use the website's authenticated routes and require your explicit submit action.
- The site remains owner-private. Adding team members inside the app does not by itself grant hosting access.

To disable: uncheck Aero Vault in **Tools → Add-Ins**. To uninstall: close SOLIDWORKS and run `Uninstall.ps1` in Windows PowerShell as administrator (also installed in `C:\Program Files\AeroVault2026`). It unregisters this add-in and removes its installed DLLs. It leaves local CAD downloads, browser profile, and cloud revisions intact.

## Source layout

`AeroVault.AddIn/AddIn.cs` owns COM registration and Task Pane lifecycle. `VaultPanel.cs` hosts WebView2 and the restricted message bridge. `CadFiles.cs` calls SOLIDWORKS Pack and Go and OpenDoc6. `SafeArchive.cs` extracts downloaded ZIPs. `tests/ArchiveTests.cs` exercises the actual extractor on Windows during Build.ps1. The website hook is `app/native/use-solidworks.ts`; bounded transfer logic and its Node tests are in `lib/native-transfer.ts` and `tests/native-transfer.test.cjs`.

References: [SOLIDWORKS API Help](https://help.solidworks.com/2026/english/api/sldworksapiprogguide/Welcome.htm), [WebView2 security guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security), [pinned Microsoft WebView2 SDK](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3405.78).
