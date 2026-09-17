using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using SolidWorks.Interop.sldworks;

namespace AeroVault.SolidWorks
{
    internal sealed class PreparedDesign
    {
        internal string Root;
        internal string[] Paths;
        internal string Stamp;
    }

    internal sealed partial class VaultPanel
    {
        private readonly List<DesignLink> links = new List<DesignLink>();
        private readonly Dictionary<string, PreparedDesign> preparedDesigns = new Dictionary<string, PreparedDesign>();
        private readonly Dictionary<string, SavedEvents> saveEvents = new Dictionary<string, SavedEvents>(StringComparer.OrdinalIgnoreCase);
        private readonly string stateFile = Path.Combine(CadFiles.LocalRoot, "AutoSync", "links.json");
        private readonly Timer syncTimer = new Timer { Interval = 2000 };
        private string ownerId;
        private bool bridgeReady;
        private bool ticking;
        private bool collecting;
        private DateTime nextPresence;
        private TaskCompletionSource<bool> cloudAcknowledgement;
        private string cloudRequest;
        private System.Threading.Mutex syncOwner;

        private void InitializeSync()
        {
            syncOwner = new System.Threading.Mutex(false, "Local\\AeroVaultAutoSync");
            bool acquired;
            try { acquired = syncOwner.WaitOne(0); } catch (System.Threading.AbandonedMutexException) { acquired = true; }
            if (!acquired) { syncOwner.Dispose(); syncOwner = null; throw new InvalidOperationException("Aero Vault is already running in another SOLIDWORKS window. Use one SOLIDWORKS process for automatic sync."); }
            try { links.AddRange(SyncState.Load(stateFile)); }
            catch { syncOwner.ReleaseMutex(); syncOwner.Dispose(); syncOwner = null; throw; }
            syncTimer.Tick += SyncTick;
            syncTimer.Start();
        }
        private void SaveLinks() { SyncState.Save(stateFile, links); }
        private void Changed(string oldPath, string newPath)
        {
            if (collecting) return;
            foreach (var link in links.Where(l => l.Paths.Contains(oldPath, StringComparer.OrdinalIgnoreCase)))
            {
                link.ObservedStamp = null;
                link.ChangedAt = DateTime.UtcNow;
                if (!String.IsNullOrEmpty(newPath) && !String.Equals(oldPath, newPath, StringComparison.OrdinalIgnoreCase))
                {
                    link.Blocked = true;
                    link.Message = "Save As changed a linked path. Keep the new file and upload/link it explicitly before syncing.";
                }
            }
        }
        private void WatchDocuments()
        {
            var required = new HashSet<string>(links.Where(l => l.OwnerId == ownerId && l.Open).SelectMany(l => l.Paths), StringComparer.OrdinalIgnoreCase);
            foreach (string path in saveEvents.Keys.ToArray())
            {
                if (!required.Contains(path) || CadFiles.FindOpen(application, path) == null) { saveEvents[path].Dispose(); saveEvents.Remove(path); }
            }
            foreach (string path in required)
            {
                if (saveEvents.ContainsKey(path)) continue;
                var doc = CadFiles.FindOpen(application, path);
                if (doc != null) saveEvents[path] = new SavedEvents(doc, name => Changed(path, name));
            }
        }
        private void PublishPresence()
        {
            if (!CanSend || !bridgeReady || String.IsNullOrEmpty(ownerId)) return;
            Send(new { type = "aerovault:presence", designs = links.Where(l => l.OwnerId == ownerId).Select(l => new {
                packageId = l.PackageId, session = l.Session, version = l.Version, name = l.Name,
                open = l.Open, pending = l.PendingId != null, blocked = l.Blocked, message = l.Message
            }).ToArray() });
        }
        private async void SyncTick(object sender, EventArgs args)
        {
            if (stopped || ticking || String.IsNullOrEmpty(ownerId)) return;
            ticking = true;
            try
            {
                foreach (var link in links.Where(l => l.OwnerId == ownerId))
                {
                    var model = CadFiles.FindOpen(application, link.Root);
                    bool wasOpen = link.Open;
                    link.Open = model != null;
                    if (link.Open != wasOpen) nextPresence = DateTime.MinValue;
                    if (!link.Open && link.PendingId == null)
                    {
                        try
                        {
                            bool unsynced = SyncState.Stamp(link.Paths) != link.SyncedStamp;
                            if (link.Blocked && !unsynced) continue;
                            link.Blocked = link.Blocked || unsynced;
                            link.Message = unsynced ? "Saved locally but closed before upload. Reopen this exact local design to sync, or disconnect and keep the local copy." : "Closed. Saved files remain on this computer.";
                        }
                        catch (Exception ex) { link.Blocked = true; link.Message = ex.Message; }
                        continue;
                    }
                    if (link.Open && !wasOpen && link.PendingId == null) link.Blocked = false;
                    if (link.Blocked || packaging) continue;
                    if (link.PendingId == null && link.Open)
                    {
                        try
                        {
                            string stamp = SyncState.Stamp(link.Paths);
                            if (stamp == link.SyncedStamp) { link.Message = model.GetSaveFlag() ? "Editing locally · save to update Aero Vault." : "Saved to Aero Vault · revision " + link.Version; continue; }
                            string[] paths = CadFiles.Dependencies(model);
                            stamp = SyncState.Stamp(paths);
                            if (link.ObservedStamp != stamp) { link.ObservedStamp = stamp; link.ChangedAt = DateTime.UtcNow; link.Message = "Saved locally · preparing upload…"; continue; }
                            if ((DateTime.UtcNow - link.ChangedAt).TotalSeconds < 2) continue;
                            // Snapshot only saved files. A later save is detected after this snapshot is acknowledged.
                            string file;
                            collecting = true;
                            try { file = CadFiles.PackageDesign(application, model); } finally { collecting = false; }
                            if (SyncState.Stamp(paths) != stamp) { try { Directory.Delete(Path.GetDirectoryName(file), true); } catch { } continue; }
                            link.Paths = paths;
                            link.PendingFile = file;
                            link.PendingId = Guid.NewGuid().ToString();
                            link.PendingStamp = stamp;
                            link.PendingVersion = link.Version;
                            SaveLinks(); // Persist snapshot and operation ID before any cloud request.
                            link.Message = "Saved locally · waiting to upload…";
                        }
                        catch (Exception ex) { link.Message = ex.Message; continue; }
                    }
                    if (link.PendingId != null && CanSend && bridgeReady && DateTime.UtcNow >= link.RetryAt)
                        await UploadSnapshot(link);
                }
                WatchDocuments();
                if (DateTime.UtcNow >= nextPresence) { PublishPresence(); nextPresence = DateTime.UtcNow.AddSeconds(15); }
                var attention = links.FirstOrDefault(l => l.OwnerId == ownerId && (l.Open || l.PendingId != null));
                if (attention != null) status.Text = attention.Name + " · " + attention.Message;
            }
            catch (Exception ex) { if (!stopped) status.Text = "Automatic sync paused: " + ex.Message; }
            finally { ticking = false; }
        }
        private async Task UploadSnapshot(DesignLink link)
        {
            packaging = true;
            cloudRequest = link.PendingId;
            cloudAcknowledgement = new TaskCompletionSource<bool>();
            try
            {
                link.Message = "Uploading saved design…";
                PublishPresence();
                await SendFile(link.PendingFile, link.PendingId, link);
                if (await Task.WhenAny(cloudAcknowledgement.Task, Task.Delay(120000)) != cloudAcknowledgement.Task)
                    throw new TimeoutException("Cloud confirmation is pending. The saved ZIP is queued for retry.");
                await cloudAcknowledgement.Task;
            }
            catch (Exception ex) { link.Message = ex.Message; }
            finally
            {
                link.RetryAt = DateTime.UtcNow.AddSeconds(20);
                packaging = false; acknowledgement = null; transferId = null;
                cloudRequest = null; cloudAcknowledgement = null;
            }
        }
        private void SyncResult(BridgeCommand command)
        {
            var link = links.FirstOrDefault(l => l.OwnerId == ownerId && l.PendingId == command.requestId);
            if (link == null) return;
            if (command.success && command.version == link.PendingVersion + 1)
            {
                string oldFile = link.PendingFile;
                link.Version = command.version;
                link.SyncedStamp = link.PendingStamp;
                link.PendingFile = null; link.PendingId = null; link.PendingStamp = null;
                bool newer = command.currentVersion > command.version;
                link.Blocked = link.Blocked || newer;
                if (newer) link.Message = "A newer cloud revision exists. Keep your local files and open the latest design.";
                else if (!link.Blocked) link.Message = "Saved to Aero Vault · revision " + link.Version;
                SaveLinks();
                try { Directory.Delete(Path.GetDirectoryName(oldFile), true); } catch { }
            }
            else
            {
                link.Blocked = command.conflict;
                link.Message = command.message ?? "Upload pending. Your local file and queued ZIP are safe.";
            }
            if (cloudRequest == command.requestId && cloudAcknowledgement != null) cloudAcknowledgement.TrySetResult(true);
            nextPresence = DateTime.MinValue;
            PublishPresence();
        }
        private void LinkPrepared(BridgeCommand command)
        {
            PreparedDesign prepared;
            if (!preparedDesigns.TryGetValue(command.preparedId ?? "", out prepared)) throw new InvalidOperationException("Prepare the active design again to link it.");
            AddLink(command, prepared.Root, prepared.Paths, prepared.Stamp);
            preparedDesigns.Remove(command.preparedId);
        }
        private void AddLink(BridgeCommand command, string root, string[] paths, string stamp)
        {
            Guid id;
            if (String.IsNullOrEmpty(ownerId) || command.ownerId != ownerId || !Guid.TryParse(command.packageId, out id) || !Guid.TryParse(command.session, out id) || command.version < 1)
                throw new InvalidOperationException("Invalid design link. Reload the workspace and try again.");
            var prior = links.FirstOrDefault(l => l.OwnerId == ownerId && (l.PackageId == command.packageId || String.Equals(l.Root, root, StringComparison.OrdinalIgnoreCase)));
            if (prior != null && (prior.PendingId != null || (File.Exists(prior.Root) && SyncState.Stamp(prior.Paths) != prior.SyncedStamp)))
                throw new InvalidOperationException("An earlier local copy has unsynced changes. Keep that copy; upload it manually or resolve the newer cloud revision before replacing its link.");
            if (prior != null) links.Remove(prior);
            links.Add(new DesignLink { PackageId = command.packageId, OwnerId = ownerId, Root = root, Name = command.name, Subsystem = command.subsystem,
                Version = command.version, Paths = paths, SyncedStamp = stamp, Session = command.session, Open = true, Message = "Automatic saves enabled." });
            SaveLinks();
            nextPresence = DateTime.MinValue;
            PublishPresence();
        }
        private void LeaseResult(BridgeCommand command)
        {
            var link = links.FirstOrDefault(l => l.OwnerId == ownerId && l.PackageId == command.packageId && l.Session == command.session);
            if (link == null || !link.Open || command.version != link.Version) return;
            // A queued operation may already have committed despite a lost response; retry it to reconcile.
            if (command.conflict && link.PendingId == null) link.Blocked = true;
            if (!command.success) link.Message = command.message ?? "Editing status is offline. Saved changes remain local.";
        }
        private void DisconnectDesign(BridgeCommand command)
        {
            if (packaging) throw new InvalidOperationException("Wait until the current transfer finishes before disconnecting a local copy.");
            var link = links.FirstOrDefault(l => l.OwnerId == ownerId && l.PackageId == command.packageId && l.Session == command.session);
            if (link == null) return;
            if (MessageBox.Show("Stop automatic updates for " + link.Name + "? Your local CAD files and any queued ZIP will stay on this computer. You can then open the latest cloud revision into a new folder.", "Disconnect local copy", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            links.Remove(link);
            SaveLinks();
            Send(new { type = "aerovault:ended", packageId = link.PackageId, session = link.Session });
            PublishPresence();
        }
        private void DisposeSync()
        {
            syncTimer.Stop(); syncTimer.Dispose();
            foreach (var watcher in saveEvents.Values) watcher.Dispose();
            if (cloudAcknowledgement != null) cloudAcknowledgement.TrySetCanceled();
            if (syncOwner != null) { try { syncOwner.ReleaseMutex(); } catch { } syncOwner.Dispose(); syncOwner = null; }
        }
    }

    internal sealed class SavedEvents : IDisposable
    {
        private PartDoc part;
        private AssemblyDoc assembly;
        private DrawingDoc drawing;
        private readonly Action<string> saved;
        internal SavedEvents(IModelDoc2 model, Action<string> handler)
        {
            saved = handler;
            part = model as PartDoc; assembly = model as AssemblyDoc; drawing = model as DrawingDoc;
            if (part != null) part.FileSavePostNotify += OnSaved;
            if (assembly != null) assembly.FileSavePostNotify += OnSaved;
            if (drawing != null) drawing.FileSavePostNotify += OnSaved;
        }
        private int OnSaved(int type, string name) { saved(name); return 0; }
        public void Dispose()
        {
            try { if (part != null) part.FileSavePostNotify -= OnSaved; } catch { }
            try { if (assembly != null) assembly.FileSavePostNotify -= OnSaved; } catch { }
            try { if (drawing != null) drawing.FileSavePostNotify -= OnSaved; } catch { }
            part = null; assembly = null; drawing = null;
        }
    }
}
