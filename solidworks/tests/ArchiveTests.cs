using System;
using System.IO;
using System.IO.Compression;
using AeroVault.SolidWorks;

internal static class ArchiveTests
{
    private static string root;
    private static int Main()
    {
        root = Path.Combine(Path.GetTempPath(), "AeroVault-Tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            string good = Create("normal", new[] { "assembly/wing.sldasm", "assembly/parts/rib.sldprt" });
            string extracted = SafeArchive.Extract(good);
            if (File.ReadAllText(Path.Combine(extracted, "assembly", "parts", "rib.sldprt")) != "sample bytes") throw new Exception("File bytes changed.");
            Reject("traversal", new[] { "../escaped.sldprt" });
            Reject("backslash", new[] { "..\\escaped.sldprt" });
            Reject("absolute", new[] { "C:/escaped.sldprt" });
            Reject("rooted", new[] { "/escaped.sldprt" });
            Reject("duplicates", new[] { "Wing.sldprt", "wing.SLDPRT" });
            Reject("device", new[] { "parts/CON.sldprt" });
            Reject("alternate-stream", new[] { "part.sldprt:stream" });
            Reject("trailing-dot", new[] { "parts./wing.sldprt" });
            string link = Create("symlink", new[] { "linked.sldprt" });
            using (ZipArchive zip = ZipFile.Open(link, ZipArchiveMode.Update)) zip.Entries[0].ExternalAttributes = unchecked((int)0xA1FF0000);
            ExpectRejected(link);
            string many = Path.Combine(root, "many.zip");
            using (ZipArchive zip = ZipFile.Open(many, ZipArchiveMode.Create))
                for (int i = 0; i < 5001; i++) zip.CreateEntry("part" + i + ".sldprt");
            ExpectRejected(many);
            Console.WriteLine("PASS: Windows ZIP bytes, nested paths, traversal, absolute paths, duplicate names, reserved names, alternate streams, symlinks, and entry limit.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally { Directory.Delete(root, true); }
    }
    private static string Create(string name, string[] entries)
    {
        string path = Path.Combine(root, name + ".zip");
        using (ZipArchive zip = ZipFile.Open(path, ZipArchiveMode.Create))
            foreach (string entry in entries)
                using (var writer = new StreamWriter(zip.CreateEntry(entry).Open())) writer.Write("sample bytes");
        return path;
    }
    private static void Reject(string name, string[] entries) { ExpectRejected(Create(name, entries)); }
    private static void ExpectRejected(string path)
    {
        int before = Directory.GetDirectories(root, "Design-*").Length;
        try { SafeArchive.Extract(path); }
        catch (InvalidDataException)
        {
            if (Directory.GetDirectories(root, "Design-*").Length != before) throw new Exception("Rejected package was not cleaned up.");
            if (File.Exists(Path.Combine(root, "escaped.sldprt"))) throw new Exception("A file escaped its design directory.");
            return;
        }
        throw new Exception("Unsafe ZIP was accepted: " + Path.GetFileName(path));
    }
}
