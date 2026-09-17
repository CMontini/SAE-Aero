using System;
using System.Collections.Generic;
using System.IO;
using AeroVault.SolidWorks;

internal static class SyncStateTests
{
    private static int Main()
    {
        string root = Path.Combine(Path.GetTempPath(), "AeroVault-SyncTests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            string file = Path.Combine(root, "part.sldprt"), queue = Path.Combine(root, "queued.zip"), state = Path.Combine(root, "links.json");
            File.WriteAllText(file, "first save"); File.WriteAllText(queue, "immutable queued bytes");
            string stamp = SyncState.Stamp(new[] { file });
            var link = new DesignLink { OwnerId = "test", PackageId = Guid.NewGuid().ToString(), Root = file, Paths = new[] { file }, Version = 3,
                SyncedStamp = stamp, PendingFile = queue, PendingId = Guid.NewGuid().ToString(), PendingVersion = 3, PendingStamp = stamp, Session = Guid.NewGuid().ToString() };
            SyncState.Save(state, new List<DesignLink> { link });
            File.AppendAllText(file, " and another save during upload");
            var restored = SyncState.Load(state)[0];
            if (restored.PendingId != link.PendingId || restored.PendingVersion != 3 || restored.Version != 3 || restored.SyncedStamp != stamp || restored.Session == link.Session)
                throw new Exception("Restart lost an operation, advanced an unconfirmed version, or reused a session.");
            if (SyncState.Stamp(restored.Paths) == stamp || File.ReadAllText(restored.PendingFile) != "immutable queued bytes")
                throw new Exception("A later save replaced the immutable outbox or was not detected.");
            restored.Version = 4; restored.PendingId = null; restored.PendingFile = null;
            SyncState.Save(state, new List<DesignLink> { restored });
            if (SyncState.Load(state)[0].Version != 4) throw new Exception("Atomic state replacement failed.");
            File.Delete(file);
            bool missing = false;
            try { SyncState.Stamp(restored.Paths); } catch (IOException) { missing = true; }
            if (!missing) throw new Exception("A missing dependency was silently accepted.");
            Console.WriteLine("PASS: durable outbox, immutable snapshots, later-save detection, session renewal, atomic state replacement, and missing dependencies.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally { Directory.Delete(root, true); }
    }
}
