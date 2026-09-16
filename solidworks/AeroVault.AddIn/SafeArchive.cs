using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text.RegularExpressions;

namespace AeroVault.SolidWorks
{
    // Never extract directly into an existing user's design folder.
    internal static class SafeArchive
    {
        internal static string Extract(string archive)
        {
            string destination = Path.Combine(Path.GetDirectoryName(archive), "Design-" + Guid.NewGuid().ToString("N"));
            string prefix = Path.GetFullPath(destination) + Path.DirectorySeparatorChar;
            var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            long total = 0;
            const long maximum = 512L * 1024 * 1024;
            Directory.CreateDirectory(destination);
            try
            {
                using (ZipArchive zip = ZipFile.OpenRead(archive))
                {
                    if (zip.Entries.Count > 5000) throw new InvalidDataException("This package contains too many entries.");
                    foreach (ZipArchiveEntry entry in zip.Entries)
                    {
                        if (((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000) throw new InvalidDataException("Symbolic links are not allowed in design packages.");
                        string relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                        if (Path.IsPathRooted(relative)) throw new InvalidDataException("The ZIP contains an absolute path.");
                        foreach (string component in relative.Split(Path.DirectorySeparatorChar))
                        {
                            if (component.Length == 0) continue;
                            if (component == "." || component == ".." || component.TrimEnd(' ', '.') != component || component.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || Regex.IsMatch(component, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)", RegexOptions.IgnoreCase))
                                throw new InvalidDataException("The ZIP contains an unsafe Windows filename.");
                        }
                        string target = Path.GetFullPath(Path.Combine(destination, relative));
                        if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The ZIP contains a path outside its design folder.");
                        if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                        if (!paths.Add(target)) throw new InvalidDataException("The ZIP contains duplicate file paths.");
                        if (entry.Length > maximum - total) throw new InvalidDataException("The unpacked package exceeds 512 MB.");
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        using (Stream input = entry.Open())
                        using (FileStream output = new FileStream(target, FileMode.CreateNew, FileAccess.Write))
                        {
                            byte[] buffer = new byte[65536];
                            int count;
                            while ((count = input.Read(buffer, 0, buffer.Length)) != 0)
                            {
                                total += count;
                                if (total > maximum) throw new InvalidDataException("The unpacked package exceeds 512 MB.");
                                output.Write(buffer, 0, count);
                            }
                        }
                    }
                }
                return destination;
            }
            catch { try { Directory.Delete(destination, true); } catch { } throw; }
        }
    }
}
