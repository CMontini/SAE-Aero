using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using SolidWorks.Interop.sldworks;

namespace AeroVault.SolidWorks
{
    internal sealed class BridgeCommand
    {
        public string type { get; set; }
        public string requestId { get; set; }
        public string revisionId { get; set; }
        public bool readOnly { get; set; }
        public int index { get; set; }
        public int protocol { get; set; }
    }

    internal sealed class VaultPanel : UserControl
    {
        internal const string Home = "https://aero-vault.carson-montini.chatgpt.site";
        private readonly ISldWorks application;
        private readonly WebView2 browser;
        private readonly Label status;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 1024 * 1024 };
        private readonly Dictionary<string, bool> openRequests = new Dictionary<string, bool>();
        private bool packaging;
        private bool stopped;
        private TaskCompletionSource<bool> acknowledgement;
        private string transferId;
        private int transferIndex;

        internal VaultPanel(ISldWorks app)
        {
            application = app;
            BackColor = Color.White;
            var toolbar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 42, Padding = new Padding(4), WrapContents = false };
            var home = new Button { Text = "Workspace", AutoSize = true };
            var external = new Button { Text = "Open in browser", AutoSize = true };
            home.Click += delegate { if (browser.CoreWebView2 != null) browser.CoreWebView2.Navigate(Home + "/?solidworks=1"); };
            external.Click += delegate { Process.Start(new ProcessStartInfo(Home) { UseShellExecute = true }); };
            toolbar.Controls.Add(home);
            toolbar.Controls.Add(external);
            status = new Label { Dock = DockStyle.Bottom, Height = 48, Padding = new Padding(8), Text = "Aero Vault pilot · initializing…", AutoEllipsis = true };
            browser = new WebView2 { Dock = DockStyle.Fill };
            Controls.Add(browser);
            Controls.Add(toolbar);
            Controls.Add(status);
        }

        internal async void Start()
        {
            try
            {
                string folder = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                try { CoreWebView2Environment.SetLoaderDllFolderPath(folder); }
                catch (InvalidOperationException) { /* Another add-in may already have loaded the shared WebView2 loader. */ }
                string profile = Path.Combine(CadFiles.LocalRoot, "WebView2");
                var environment = await CoreWebView2Environment.CreateAsync(null, profile);
                if (stopped) return;
                await browser.EnsureCoreWebView2Async(environment);
                browser.CoreWebView2.Settings.AreHostObjectsAllowed = false;
                browser.CoreWebView2.WebMessageReceived += OnMessage;
                browser.CoreWebView2.DownloadStarting += OnDownload;
                browser.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e)
                {
                    Uri uri;
                    if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out uri) || (uri.Scheme != "https" && e.Uri != "about:blank")) e.Cancel = true;
                    if (!Trusted(e.Uri)) { CancelTransfer(); status.Text = "Sign in to your existing Aero Vault account. Native actions are disabled on sign-in pages."; }
                };
                browser.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e)
                {
                    // Keep the same browser session for sign-in. No cookie export, host tokens, or sign-in bypass.
                    e.Handled = true;
                    Uri uri;
                    if (Uri.TryCreate(e.Uri, UriKind.Absolute, out uri) && uri.Scheme == "https") browser.CoreWebView2.Navigate(e.Uri);
                };
                browser.CoreWebView2.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs e)
                {
                    if (e.IsSuccess && Trusted(browser.CoreWebView2.Source)) status.Text = "Aero Vault · connected panel. Sign in if prompted.";
                    else if (!e.IsSuccess) status.Text = "Could not load the workspace. Check your connection and select Workspace to retry.";
                };
                browser.CoreWebView2.Navigate(Home + "/?solidworks=1");
            }
            catch (Exception ex)
            {
                status.Text = "Panel startup failed. Check Microsoft Edge WebView2 Runtime and the installation guide.";
                MessageBox.Show(ex.Message + "\n\nInstall the Microsoft Edge WebView2 Evergreen Runtime if it is missing, then restart SOLIDWORKS normally (not as administrator).", "Aero Vault startup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static bool Trusted(string source)
        {
            Uri uri;
            return Uri.TryCreate(source, UriKind.Absolute, out uri) && uri.GetLeftPart(UriPartial.Authority).Equals(Home, StringComparison.OrdinalIgnoreCase);
        }
        private bool CanSend { get { return !stopped && browser.CoreWebView2 != null && Trusted(browser.CoreWebView2.Source); } }
        private void Send(object message)
        {
            if (!CanSend) throw new InvalidOperationException("Return to Aero Vault before using a SolidWorks action.");
            browser.CoreWebView2.PostWebMessageAsJson(json.Serialize(message));
        }
        private void CancelTransfer()
        {
            if (acknowledgement != null) acknowledgement.TrySetCanceled();
        }
        private void Report(string id, string message)
        {
            if (!stopped) status.Text = message;
            if (CanSend) Send(new { type = "aerovault:error", requestId = id, message = message });
        }

        private async void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (!CanSend || !Trusted(e.Source)) return;
            string id = null;
            try
            {
                string raw = e.WebMessageAsJson;
                if (raw.Length > 4096) throw new InvalidOperationException("The native request was too large.");
                BridgeCommand command = json.Deserialize<BridgeCommand>(raw);
                if (command == null) return;
                id = command.requestId;
                if (command.type == "aerovault:hello" && command.protocol == 1)
                {
                    Send(new { type = "aerovault:ready", protocol = 1, version = "0.2.0" });
                    return;
                }
                if (command.type == "aerovault:ack")
                {
                    if (command.requestId == transferId && command.index == transferIndex && acknowledgement != null) acknowledgement.TrySetResult(true);
                    return;
                }
                Guid parsed;
                if (!Guid.TryParse(id, out parsed)) throw new InvalidOperationException("Invalid native request identifier.");
                if (command.type == "aerovault:package-active")
                {
                    if (packaging) throw new InvalidOperationException("A design is already being prepared.");
                    packaging = true;
                    string file = null;
                    try
                    {
                        status.Text = "Collecting the active design and its linked files…";
                        // All SOLIDWORKS COM calls stay on the application's UI thread.
                        file = CadFiles.PackageActive(application);
                        long size = new FileInfo(file).Length;
                        Send(new { type = "aerovault:file-begin", requestId = id, name = Path.GetFileName(file), size = size });
                        using (FileStream stream = File.OpenRead(file))
                        {
                            byte[] buffer = new byte[384 * 1024];
                            int count, index = 0;
                            while ((count = stream.Read(buffer, 0, buffer.Length)) > 0)
                            {
                                transferId = id;
                                transferIndex = index;
                                acknowledgement = new TaskCompletionSource<bool>();
                                Send(new { type = "aerovault:file-chunk", requestId = id, index = index, data = Convert.ToBase64String(buffer, 0, count) });
                                if (await Task.WhenAny(acknowledgement.Task, Task.Delay(15000)) != acknowledgement.Task) throw new TimeoutException("The panel stopped receiving the package. Return to the upload form and try again.");
                                await acknowledgement.Task;
                                index++;
                            }
                        }
                        Send(new { type = "aerovault:file-complete", requestId = id });
                        status.Text = "Package prepared. Review the change notes and choose Upload or Check in to save it to the team workspace.";
                    }
                    finally
                    {
                        packaging = false;
                        acknowledgement = null;
                        transferId = null;
                        if (file != null) { try { Directory.Delete(Path.GetDirectoryName(file), true); } catch { } }
                    }
                    return;
                }
                if (command.type == "aerovault:open-revision")
                {
                    if (packaging) throw new InvalidOperationException("Wait for the current package to finish.");
                    if (!Guid.TryParse(command.revisionId, out parsed)) throw new InvalidOperationException("Invalid revision identifier.");
                    string url = Home + "/api/download?id=" + Uri.EscapeDataString(command.revisionId);
                    openRequests[url] = command.readOnly;
                    status.Text = "Downloading the selected revision…";
                    browser.CoreWebView2.Navigate(url);
                }
            }
            catch (Exception ex) { Report(id, ex.Message); }
        }

        private void OnDownload(object sender, CoreWebView2DownloadStartingEventArgs e)
        {
            try
            {
                var operation = e.DownloadOperation;
                Uri uri;
                if (!Trusted(operation.Uri) || !Uri.TryCreate(operation.Uri, UriKind.Absolute, out uri) || uri.AbsolutePath != "/api/download") { e.Cancel = true; return; }
                string name = Path.GetFileName(e.ResultFilePath);
                string extension = Path.GetExtension(name).ToLowerInvariant();
                if (extension != ".zip" && CadFiles.DocumentType(name) == 0) { e.Cancel = true; Report(null, "This download is not a supported design file."); return; }
                if (name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) { e.Cancel = true; return; }
                bool readOnly = true, requested;
                if (openRequests.TryGetValue(operation.Uri, out requested)) { readOnly = requested; openRequests.Remove(operation.Uri); }
                string folder = Path.Combine(CadFiles.LocalRoot, "Downloads", Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(folder);
                string file = Path.Combine(folder, name);
                e.ResultFilePath = file;
                e.Handled = true;
                EventHandler<object> bytesChanged = delegate { if (operation.BytesReceived > CadFiles.MaximumBytes) operation.Cancel(); };
                EventHandler<object> stateChanged = null;
                stateChanged = async delegate
                {
                    if (operation.State == CoreWebView2DownloadState.InProgress) return;
                    operation.StateChanged -= stateChanged;
                    operation.BytesReceivedChanged -= bytesChanged;
                    if (stopped) return;
                    if (operation.State != CoreWebView2DownloadState.Completed) { Report(null, "Download interrupted. Your cloud revision is unchanged; try again."); return; }
                    try
                    {
                        if (new FileInfo(file).Length > CadFiles.MaximumBytes) throw new InvalidDataException("The download exceeds 50 MB.");
                        string chosen = file;
                        if (extension == ".zip")
                        {
                            status.Text = "Unpacking the design into a new local folder…";
                            string extracted = await Task.Run(() => SafeArchive.Extract(file));
                            if (stopped) return;
                            string[] candidates = Directory.GetFiles(extracted, "*", SearchOption.AllDirectories).Where(path => CadFiles.DocumentType(path) != 0).ToArray();
                            if (candidates.Length == 0) throw new InvalidDataException("The package contains no SolidWorks parts, assemblies, or drawings.");
                            if (candidates.Length == 1) chosen = candidates[0];
                            else
                            {
                                using (var picker = new OpenFileDialog { InitialDirectory = extracted, Title = "Choose the top-level assembly or design to open", Filter = "SolidWorks designs|*.sldasm;*.sldprt;*.slddrw", CheckFileExists = true, RestoreDirectory = true })
                                {
                                    if (picker.ShowDialog(this) != DialogResult.OK) { status.Text = "Download saved. No design was opened."; return; }
                                    chosen = picker.FileName;
                                }
                            }
                        }
                        CadFiles.Open(application, chosen, readOnly);
                        status.Text = readOnly ? "Opened read-only. Check out the latest revision in Aero Vault before editing." : "Opened for editing. Save your changes, then check in a new package.";
                    }
                    catch (Exception ex) { Report(null, ex.Message); }
                };
                operation.BytesReceivedChanged += bytesChanged;
                operation.StateChanged += stateChanged;
            }
            catch (Exception ex) { e.Cancel = true; Report(null, ex.Message); }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) { stopped = true; CancelTransfer(); if (browser != null) browser.Dispose(); }
            base.Dispose(disposing);
        }
    }
}
