using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swconst;

namespace AeroVault.SolidWorks
{
    internal sealed class AssemblyInput
    {
        public string packageId { get; set; }
        public string revisionId { get; set; }
        public int version { get; set; }
        public AssemblyManifest manifest { get; set; }
    }
    internal sealed partial class VaultPanel
    {
        private readonly HashSet<string> assemblyDownloadUrls = new HashSet<string>();
        private string assemblyDownloadUrl;
        private TaskCompletionSource<string> assemblyDownload;
        private bool assemblyBuilding;
        private readonly Dictionary<string, string> assemblyFailures = new Dictionary<string, string>();

        private AssemblyManifest CaptureManifest(IModelDoc2 model, DesignLink self)
        {
            string[] paths = CadFiles.Dependencies(model);
            var prior = self == null ? AssemblyManifest.FromFolder(Path.GetDirectoryName(model.GetPathName())) : AssemblyManifest.Read(self.Manifest);
            var references = new List<AssemblyReference>();
            var candidates = links.Where(l => l.OwnerId == ownerId && l != self && paths.Contains(l.Root, StringComparer.OrdinalIgnoreCase)).ToArray();
            foreach (var link in candidates)
            {
                if (candidates.Any(other => other != link && other.Paths.Contains(link.Root, StringComparer.OrdinalIgnoreCase))) continue;
                if (link.PendingId != null || SyncState.Stamp(link.Paths) != link.SyncedStamp) throw new InvalidOperationException("Wait for " + link.Name + " to finish syncing before packaging this assembly.");
                var m = AssemblyManifest.Read(link.Manifest);
                if (m == null) throw new InvalidOperationException("Prepare and upload " + link.Name + " once with Aero Vault 0.4 to track its revisions.");
                references.Add(new AssemblyReference { packageId = link.PackageId, revision = link.Version, root = m.root, files = m.files });
            }
            var files = paths.Select(Path.GetFileName).ToArray();
            if (prior != null) foreach (var r in prior.refs)
                if (!references.Any(x => x.packageId == r.packageId) && r.files.All(files.Contains)) references.Add(r);
            var result = new AssemblyManifest { protocol = 1, root = Path.GetFileName(model.GetPathName()), files = files, refs = references.ToArray() };
            result.Validate(); return result;
        }
        private async Task<string> DownloadAssembly(AssemblyInput input, string account)
        {
            Guid parsed;
            if (input == null || !Guid.TryParse(input.revisionId, out parsed) || input.manifest == null) throw new InvalidDataException("Invalid assembly download.");
            input.manifest.Validate();
            assemblyDownloadUrl = Home + "/api/download?id=" + Uri.EscapeDataString(input.revisionId);
            assemblyDownloadUrls.Add(assemblyDownloadUrl);
            assemblyDownload = new TaskCompletionSource<string>();
            try
            {
                browser.CoreWebView2.Navigate(assemblyDownloadUrl);
                if (await Task.WhenAny(assemblyDownload.Task, Task.Delay(120000)) != assemblyDownload.Task) throw new TimeoutException("Assembly download timed out.");
                string zip = await assemblyDownload.Task;
                if (stopped || ownerId != account || !bridgeReady) throw new InvalidOperationException("Sign-in changed during assembly preparation.");
                string folder = await Task.Run(() => SafeArchive.Extract(zip));
                input.manifest.VerifyFolder(folder);
                var actual = AssemblyManifest.FromFolder(folder);
                if (actual == null || actual.Serialize() != input.manifest.Serialize()) throw new InvalidDataException("Downloaded assembly metadata does not match the selected revision.");
                return folder;
            }
            finally { assemblyDownloadUrl = null; assemblyDownload = null; }
        }
        private bool HandleAssemblyDownload(CoreWebView2DownloadStartingEventArgs e)
        {
            if (e.DownloadOperation.Uri != assemblyDownloadUrl || assemblyDownload == null) {
                if (assemblyDownloadUrls.Contains(e.DownloadOperation.Uri) && !openRequests.ContainsKey(e.DownloadOperation.Uri)) { e.Cancel = true; return true; }
                return false;
            }
            var completion = assemblyDownload;
            var operation = e.DownloadOperation;
            string folder = Path.Combine(CadFiles.LocalRoot, "AssemblyDownloads", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(folder);
            string file = Path.Combine(folder, "package.zip");
            e.ResultFilePath = file; e.Handled = true;
            EventHandler<object> bytes = delegate { if (operation.BytesReceived > CadFiles.MaximumBytes) operation.Cancel(); };
            EventHandler<object> state = null;
            state = delegate
            {
                if (operation.State == CoreWebView2DownloadState.InProgress) return;
                operation.StateChanged -= state; operation.BytesReceivedChanged -= bytes;
                if (operation.State == CoreWebView2DownloadState.Completed && new FileInfo(file).Length <= CadFiles.MaximumBytes) completion.TrySetResult(file);
                else completion.TrySetException(new IOException("Assembly download was interrupted."));
            };
            operation.BytesReceivedChanged += bytes; operation.StateChanged += state; return true;
        }
        private void RequireIdle()
        {
            if (application.GetFirstDocument() != null) throw new InvalidOperationException("Waiting for idle SOLIDWORKS. Save and close open designs to rebuild linked assemblies automatically.");
        }
        private IModelDoc2 OpenBuildDocument(string file)
        {
            int errors = 0, warnings = 0;
            var model = application.OpenDoc6(file, CadFiles.DocumentType(file), (int)swOpenDocOptions_e.swOpenDocOptions_Silent, "", ref errors, ref warnings) as IModelDoc2;
            if (model == null || errors != 0 || warnings != 0) throw new InvalidOperationException("Review references before rebuilding " + Path.GetFileName(file) + " (open error " + errors + ", warning " + warnings + ").");
            return model;
        }
        private static void CheckFeatures(Feature feature, bool sub)
        {
            int count = 0;
            while (feature != null)
            {
                if (++count > 50000) throw new InvalidOperationException("Feature validation exceeded its limit.");
                bool warning;
                int error = feature.GetErrorCode2(out warning);
                if (error != 0) throw new InvalidOperationException("Review feature or mate '" + feature.Name + "' (code " + error + "). The previous cloud assembly is preserved.");
                CheckFeatures(feature.GetFirstSubFeature() as Feature, true);
                feature = (sub ? feature.GetNextSubFeature() : feature.GetNextFeature()) as Feature;
            }
        }
        private static void RebuildChecked(IModelDoc2 model)
        {
            var names = model.GetConfigurationNames() as Array;
            if (names == null || names.Length == 0) throw new InvalidOperationException("Cannot validate assembly configurations.");
            string original = model.ConfigurationManager.ActiveConfiguration.Name;
            foreach (object name in names)
            {
                if (!model.ShowConfiguration2(Convert.ToString(name)) || !model.ForceRebuild3(false)) throw new InvalidOperationException("Assembly rebuild failed in configuration " + name + ".");
                CheckFeatures(model.FirstFeature() as Feature, false);
            }
            if (!model.ShowConfiguration2(original)) throw new InvalidOperationException("Cannot restore the active assembly configuration.");
        }
        private async Task BuildAssembly(BridgeCommand command)
        {
            if (packaging || assemblyBuilding || ticking) throw new InvalidOperationException("Waiting for the current save to finish.");
            bool create = String.IsNullOrEmpty(command.packageId);
            string account = ownerId;
            string stage = Path.Combine(CadFiles.LocalRoot, "Assemblies", Guid.NewGuid().ToString("N"));
            bool opened = false;
            string signature = account + ":" + command.packageId + ":" + command.version + ":" + json.Serialize(command.dependencies);
            packaging = true; assemblyBuilding = true; collecting = true;
            try
            {
                RequireIdle();
                string previousFailure;
                if (!create && assemblyFailures.TryGetValue(signature, out previousFailure)) throw new InvalidOperationException(previousFailure);
                if (command.dependencies == null || command.dependencies.Length == 0 || command.dependencies.Length > 64) throw new InvalidOperationException("Add at least one tracked assembly to Main Assemblies first.");
                if (!create && links.Any(l => l.OwnerId == account && l.PackageId == command.packageId && (l.PendingId != null || l.Blocked || (File.Exists(l.Root) && SyncState.Stamp(l.Paths) != l.SyncedStamp)))) throw new InvalidOperationException("Resolve this assembly's local pending save before rebuilding it.");
                Directory.CreateDirectory(stage);
                AssemblyManifest parent = command.manifest;
                if (!create)
                {
                    string source = await DownloadAssembly(new AssemblyInput { revisionId = command.revisionId, manifest = parent }, account);
                    foreach (string name in parent.files) File.Copy(Path.Combine(source, name), Path.Combine(stage, name));
                    try { Directory.Delete(Path.GetDirectoryName(source), true); } catch { }
                }
                var replaced = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var parentOwned = new HashSet<string>(parent == null ? new string[0] : parent.files.Where(f => !parent.refs.Any(r => r.files.Contains(f))), StringComparer.OrdinalIgnoreCase);
                var refs = new List<AssemblyReference>();
                string root = create ? "SAEAEROMAIN.SLDASM" : parent.root;
                // Parent-owned files may never be replaced by a newly added component.
                if (parent != null) foreach (string f in parent.files.Where(f => !parent.refs.Any(r => r.files.Contains(f)))) replaced.Add(f);
                replaced.Add(root);
                foreach (var child in command.dependencies)
                {
                    string source = await DownloadAssembly(child, account);
                    if (child.manifest.files.Any(f => parentOwned.Contains(f)) || child.manifest.files.Contains(root, StringComparer.OrdinalIgnoreCase)) throw new InvalidDataException("A dependency conflicts with the assembly's own filename.");
                    AssemblyManifest.Overlay(stage, source, child.manifest, replaced);
                    try { Directory.Delete(Path.GetDirectoryName(source), true); } catch { }
                    refs.Add(new AssemblyReference { packageId = child.packageId, revision = child.version, root = child.manifest.root, files = child.manifest.files });
                }
                if (ownerId != account || !bridgeReady) throw new InvalidOperationException("Sign-in changed during assembly preparation.");
                RequireIdle(); opened = true;
                IModelDoc2 model;
                if (create)
                {
                    string template = application.GetUserPreferenceStringValue((int)swUserPreferenceStringValue_e.swDefaultTemplateAssembly);
                    if (String.IsNullOrEmpty(template) || !File.Exists(template)) throw new InvalidOperationException("Set your default assembly template in SOLIDWORKS Options > Default Templates.");
                    model = application.NewDocument(template, 0, 0, 0) as IModelDoc2;
                    if (model == null) throw new InvalidOperationException("SOLIDWORKS could not create the master assembly.");
                }
                else model = OpenBuildDocument(Path.Combine(stage, root));
                var assembly = model as IAssemblyDoc;
                if (assembly == null) throw new InvalidOperationException("The root design is not an assembly.");
                foreach (var r in refs.Where(r => create || !parent.refs.Any(old => old.packageId == r.packageId)))
                {
                    string childPath = Path.Combine(stage, r.root);
                    OpenBuildDocument(childPath); // AddComponent5 requires the component to be loaded.
                    int activation = 0;
                    application.ActivateDoc3(model.GetTitle(), false, (int)swRebuildOnActivation_e.swDontRebuildActiveDoc, ref activation);
                    var component = assembly.AddComponent5(childPath, (int)swAddComponentConfigOptions_e.swAddComponentConfigOptions_CurrentSelectedConfig, "", false, "", 0, 0, 0);
                    if (component == null) throw new InvalidOperationException("Could not insert " + r.root + ".");
                    var math = application.GetMathUtility() as MathUtility;
                    if (math == null) throw new InvalidOperationException("Cannot position the new component.");
                    component.Transform2 = math.CreateTransform(new double[] { 1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0 }) as MathTransform;
                }
                RebuildChecked(model);
                // Rebuild may dirty loaded children. Save only documents in this isolated staging tree.
                var stagedDoc = application.GetFirstDocument() as IModelDoc2;
                while (stagedDoc != null)
                {
                    string stagedPath = stagedDoc.GetPathName();
                    if (!String.IsNullOrEmpty(stagedPath))
                    {
                        if (!Path.GetFullPath(stagedPath).StartsWith(Path.GetFullPath(stage) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("A reference escaped the staged package.");
                        RebuildChecked(stagedDoc);
                        int childErrors = 0, childWarnings = 0;
                        if (!stagedDoc.Save3((int)swSaveAsOptions_e.swSaveAsOptions_Silent, ref childErrors, ref childWarnings) || childErrors != 0 || childWarnings != 0) throw new InvalidOperationException("Could not save rebuilt dependency " + stagedDoc.GetTitle() + ".");
                    }
                    stagedDoc = stagedDoc.GetNext() as IModelDoc2;
                }
                int errors = 0, warnings = 0;
                if (!model.Extension.SaveAs(Path.Combine(stage, root), 0, (int)swSaveAsOptions_e.swSaveAsOptions_Silent, null, ref errors, ref warnings) || errors != 0 || warnings != 0) throw new InvalidOperationException("Could not save the rebuilt assembly (error " + errors + ", warning " + warnings + ").");
                string[] paths = CadFiles.Dependencies(model);
                if (paths.Any(p => !Path.GetFullPath(p).StartsWith(Path.GetFullPath(stage) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))) throw new InvalidOperationException("References resolved outside the staged assembly. Review its references before publishing.");
                var manifest = new AssemblyManifest { protocol = 1, root = root, files = paths.Select(Path.GetFileName).ToArray(), refs = refs.ToArray() };
                manifest.Validate();
                File.WriteAllText(Path.Combine(stage, AssemblyManifest.Filename), manifest.Serialize());
                string zip = CadFiles.PackageDesign(application, model); manifest.WriteZip(zip);
                string stamp = SyncState.Stamp(paths);
                if (create)
                {
                    preparedDesigns.Clear();
                    preparedDesigns[command.requestId] = new PreparedDesign { Root = Path.Combine(stage, root), Paths = paths, Stamp = stamp, Manifest = manifest.Serialize() };
                    // Leave the new draft open for positioning and mates.
                    opened = false; collecting = false;
                    await SendFile(zip, command.requestId, null);
                    try { Directory.Delete(Path.GetDirectoryName(zip), true); } catch { }
                }
                else
                {
                    CloseBuildDocuments(); opened = false;
                    AddLink(command, Path.Combine(stage, root), paths, stamp);
                    var link = links.First(l => l.OwnerId == account && l.PackageId == command.packageId);
                    link.Open = false; link.PendingFile = zip; link.PendingId = Guid.NewGuid().ToString(); link.PendingVersion = command.version; link.PendingStamp = stamp; link.PendingManifest = manifest.Serialize(); link.Rebuild = true;
                    SaveLinks(); collecting = false;
                    await UploadSnapshot(link);
                }
                if (CanSend) Send(new { type = "aerovault:assembly-result", requestId = command.requestId, success = true, message = create ? "Master draft created. Position and mate its subassemblies, then save." : "Assembly rebuild processed." });
            }
            catch (Exception ex)
            {
                if (!create && Directory.Exists(stage) && Directory.GetFiles(stage).Length > 0) {
                    if (assemblyFailures.Count > 128) assemblyFailures.Clear();
                    assemblyFailures[signature] = ex.Message + " Repair and save the affected source or assembly revision before retrying.";
                }
                if (CanSend) Send(new { type = "aerovault:assembly-result", requestId = command.requestId, success = false, message = ex.Message + (opened ? " Review copy: " + stage : "") });
                if (create) Report(command.requestId, ex.Message);
            }
            finally
            {
                if (opened) CloseBuildDocuments();
                packaging = false; assemblyBuilding = false; collecting = false;
            }
        }
        private void CloseBuildDocuments()
        {
            // Only called after RequireIdle and synchronous CAD work; every open document was opened here.
            var doc = application.GetFirstDocument() as IModelDoc2;
            while (doc != null) { application.CloseDoc(doc.GetTitle()); doc = application.GetFirstDocument() as IModelDoc2; }
        }
    }
}
