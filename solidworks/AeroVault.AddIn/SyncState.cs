using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace AeroVault.SolidWorks
{
    public sealed class DesignLink
    {
        public string Manifest { get; set; }
        public string PendingManifest { get; set; }
        public bool Rebuild { get; set; }
        public string PackageId { get; set; }
        public string OwnerId { get; set; }
        public string Root { get; set; }
        public string Name { get; set; }
        public string Subsystem { get; set; }
        public int Version { get; set; }
        public string[] Paths { get; set; }
        public string SyncedStamp { get; set; }
        public string PendingFile { get; set; }
        public string PendingId { get; set; }
        public string PendingStamp { get; set; }
        public int PendingVersion { get; set; }
        [ScriptIgnore] public string Session { get; set; }
        [ScriptIgnore] public bool Open { get; set; }
        [ScriptIgnore] public bool Blocked { get; set; }
        [ScriptIgnore] public string Message { get; set; }
        [ScriptIgnore] public string ObservedStamp { get; set; }
        [ScriptIgnore] public DateTime ChangedAt { get; set; }
        [ScriptIgnore] public DateTime RetryAt { get; set; }
    }

    internal static class SyncState
    {
        internal static string Stamp(IEnumerable<string> paths)
        {
            var text = new StringBuilder();
            foreach (string path in paths.Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(p => p, StringComparer.OrdinalIgnoreCase))
            {
                var info = new FileInfo(path);
                if (!info.Exists) throw new IOException("A linked design file is missing: " + Path.GetFileName(path));
                text.Append(path.ToUpperInvariant()).Append('|').Append(info.Length).Append('|').Append(info.LastWriteTimeUtc.Ticks).Append('\n');
            }
            using (var hash = SHA256.Create()) return Convert.ToBase64String(hash.ComputeHash(Encoding.UTF8.GetBytes(text.ToString())));
        }
        internal static List<DesignLink> Load(string file)
        {
            if (!File.Exists(file)) return new List<DesignLink>();
            var links = new JavaScriptSerializer().Deserialize<List<DesignLink>>(File.ReadAllText(file)) ?? new List<DesignLink>();
            foreach (var link in links)
            {
                link.Session = Guid.NewGuid().ToString();
                link.Message = "Waiting for the linked design to open.";
                if (link.PendingFile != null && !File.Exists(link.PendingFile))
                    throw new IOException("A queued Aero Vault upload is missing. Keep your local designs and inspect " + file);
            }
            return links;
        }
        internal static void Save(string file, List<DesignLink> links)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            string temporary = file + ".tmp";
            File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(links));
            if (File.Exists(file)) File.Replace(temporary, file, file + ".bak");
            else File.Move(temporary, file);
        }
    }
}
