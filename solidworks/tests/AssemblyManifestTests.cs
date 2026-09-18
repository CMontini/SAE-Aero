using System;
using System.IO;
using System.IO.Compression;
using System.Collections.Generic;
using AeroVault.SolidWorks;

internal static class AssemblyManifestTests
{
    static void MustFail(Action action)
    {
        try { action(); } catch (InvalidDataException) { return; }
        throw new Exception("Expected invalid package rejection.");
    }
    static AssemblyManifest Manifest(string root)
    {
        return new AssemblyManifest { protocol = 1, root = root, files = new[] { root }, refs = new AssemblyReference[0] };
    }
    static int Main()
    {
        string stage = Path.Combine(Path.GetTempPath(), "AeroVaultManifestTest-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(stage);
        try
        {
            var part = Manifest("spar.SLDPRT");
            var roundtrip = AssemblyManifest.Read(part.Serialize());
            if (roundtrip.root != part.root) throw new Exception("Manifest identity lost.");
            MustFail(() => Manifest("..\\escape.SLDPRT").Validate());
            MustFail(() => Manifest("CON.SLDPRT").Validate());
            MustFail(() => Manifest("C:\\escape.SLDPRT").Validate());
            MustFail(() => Manifest("part.SLDPRT:extra").Validate());
            var duplicate = Manifest("part.SLDPRT"); duplicate.files = new[] { "part.SLDPRT", "PART.SLDPRT" };
            MustFail(() => duplicate.Validate());
            var self = Manifest("Wing.SLDASM"); self.refs = new[] { new AssemblyReference { packageId = Guid.NewGuid().ToString(), revision = 1, root = self.root, files = self.files } };
            MustFail(() => self.Validate());
            string one = Path.Combine(stage, "one"), two = Path.Combine(stage, "two"), output = Path.Combine(stage, "out");
            Directory.CreateDirectory(one); Directory.CreateDirectory(two); Directory.CreateDirectory(output);
            File.WriteAllText(Path.Combine(one,part.root), "first"); File.WriteAllText(Path.Combine(two,part.root), "second");
            var replaced = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            AssemblyManifest.Overlay(output, one, part, replaced);
            MustFail(() => AssemblyManifest.Overlay(output, two, part, replaced));
            if (File.ReadAllText(Path.Combine(output,part.root)) != "first") throw new Exception("Conflicting file was overwritten.");
            AssemblyManifest.Overlay(output, one, part, replaced); // Identical shared component is permitted.
            File.WriteAllText(Path.Combine(output,"Master.SLDASM"), "MATES AND POSITIONS");
            replaced.Clear(); AssemblyManifest.Overlay(output, two, part, replaced);
            if (File.ReadAllText(Path.Combine(output,"Master.SLDASM")) != "MATES AND POSITIONS") throw new Exception("Master file was modified by dependency overlay.");
            string zip = Path.Combine(stage, "test.zip");
            ZipFile.CreateFromDirectory(one, zip); part.WriteZip(zip);
            string unpack = Path.Combine(stage,"unpack"); ZipFile.ExtractToDirectory(zip, unpack);
            AssemblyManifest.FromFolder(unpack).VerifyFolder(unpack);
            File.Delete(Path.Combine(unpack, part.root));
            MustFail(() => part.VerifyFolder(unpack));
            Console.WriteLine("PASS: manifest roundtrip, Windows path safety, reserved names, duplicate names, self ownership, conflicting dependencies, unchanged master bytes, ZIP metadata and missing references.");
            return 0;
        }
        catch (Exception ex) { Console.Error.WriteLine(ex); return 1; }
        finally { try { Directory.Delete(stage, true); } catch { } }
    }
}
