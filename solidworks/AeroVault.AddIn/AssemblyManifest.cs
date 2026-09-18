using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.IO.Compression;
using System.Web.Script.Serialization;

namespace AeroVault.SolidWorks
{
    public sealed class AssemblyReference
    {
        public string packageId { get; set; }
        public int revision { get; set; }
        public string root { get; set; }
        public string[] files { get; set; }
    }
    public sealed class AssemblyManifest
    {
        public int protocol { get; set; }
        public string root { get; set; }
        public string[] files { get; set; }
        public AssemblyReference[] refs { get; set; }
        internal const string Filename = "aerovault-manifest.json";
        internal static bool CadName(string s)
        {
            return !String.IsNullOrEmpty(s) && s.Length <= 180 && s == Path.GetFileName(s) && s.IndexOfAny(Path.GetInvalidFileNameChars()) < 0 && !System.Text.RegularExpressions.Regex.IsMatch(s, @"^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)", System.Text.RegularExpressions.RegexOptions.IgnoreCase) && !s.EndsWith(".") && !s.EndsWith(" ") && System.Text.RegularExpressions.Regex.IsMatch(s, @"\.(sldasm|sldprt|slddrw)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        }
        internal void Validate()
        {
            if (protocol != 1 || !CadName(root) || files == null || files.Length == 0 || files.Length > 512 || files.Any(f => !CadName(f)) || files.Distinct(StringComparer.OrdinalIgnoreCase).Count() != files.Length || !files.Contains(root) || refs == null || refs.Length > 64)
                throw new InvalidDataException("Invalid assembly manifest.");
            var ids = new HashSet<string>();
            foreach (var r in refs)
            {
                Guid id;
                if (r == null || !Guid.TryParse(r.packageId, out id) || !ids.Add(r.packageId) || r.revision < 1 || !CadName(r.root) || r.files == null || !r.files.Contains(r.root) || r.files.Any(f => !files.Contains(f)) || r.files.Contains(root)) throw new InvalidDataException("Invalid assembly reference.");
            }
        }
        internal static AssemblyManifest Read(string raw)
        {
            if (String.IsNullOrEmpty(raw)) return null;
            if (raw.Length > 48000) throw new InvalidDataException("Assembly manifest is too large.");
            var m = new JavaScriptSerializer().Deserialize<AssemblyManifest>(raw); m.Validate(); return m;
        }
        internal string Serialize() { Validate(); var raw = new JavaScriptSerializer().Serialize(this); if (raw.Length > 48000) throw new InvalidDataException("Assembly manifest is too large."); return raw; }
        internal static AssemblyManifest FromFolder(string folder)
        {
            string file = Path.Combine(folder, Filename);
            return File.Exists(file) ? Read(File.ReadAllText(file)) : null;
        }
        internal void WriteZip(string zip)
        {
            using (var archive = ZipFile.Open(zip, ZipArchiveMode.Update))
            {
                var cad = archive.Entries.Where(e => CadName(e.FullName)).Select(e => e.FullName).ToArray();
                if (cad.Length != files.Length || files.Any(f => !cad.Contains(f))) throw new InvalidDataException("Pack and Go did not produce the expected flat CAD package.");
                if (archive.Entries.Any(e => e.FullName != e.Name)) throw new InvalidDataException("Pack and Go returned nested paths. Use unique CAD filenames and flatten the package.");
                var old = archive.GetEntry(Filename); if (old != null) old.Delete();
                using (var writer = new StreamWriter(archive.CreateEntry(Filename).Open())) writer.Write(Serialize());
            }
        }
        internal void VerifyFolder(string folder)
        {
            Validate();
            foreach (string file in files) if (!File.Exists(Path.Combine(folder, file))) throw new InvalidDataException("Missing referenced file: " + file);
        }
        // Compose in a NEW staging directory. Never touch the user's working files.
        internal static void Overlay(string folder, string source, AssemblyManifest child, HashSet<string> replaced)
        {
            child.VerifyFolder(source);
            foreach (string name in child.files)
            {
                string destination = Path.Combine(folder, name), incoming = Path.Combine(source, name);
                if (replaced.Contains(name) && File.Exists(destination) && !EqualFiles(destination, incoming))
                    throw new InvalidDataException("Two packages contain different files named " + name + ". Give distinct designs unique CAD filenames before assembling.");
                File.Copy(incoming, destination, true); replaced.Add(name);
            }
        }
        private static bool EqualFiles(string a, string b)
        {
            if (new FileInfo(a).Length != new FileInfo(b).Length) return false;
            using (var hash = System.Security.Cryptography.SHA256.Create())
            using (var x = File.OpenRead(a))
            using (var y = File.OpenRead(b)) return hash.ComputeHash(x).SequenceEqual(hash.ComputeHash(y));
        }
    }
}
