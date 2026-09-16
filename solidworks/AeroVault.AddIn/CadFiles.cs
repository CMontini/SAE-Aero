using System;
using System.IO;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swconst;

namespace AeroVault.SolidWorks
{
    internal static class CadFiles
    {
        internal const long MaximumBytes = 50L * 1024 * 1024;
        internal static readonly string LocalRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AeroVault");

        internal static string PackageActive(ISldWorks application)
        {
            IModelDoc2 model = application.ActiveDoc as IModelDoc2;
            if (model == null) throw new InvalidOperationException("Open a part, assembly, or drawing first.");
            if (String.IsNullOrEmpty(model.GetPathName())) throw new InvalidOperationException("Save the active design in SOLIDWORKS first.");
            IModelDoc2 open = application.GetFirstDocument() as IModelDoc2;
            while (open != null)
            {
                if (open.GetSaveFlag()) throw new InvalidOperationException("Save your open SOLIDWORKS documents before packaging. This includes any modified linked parts.");
                open = open.GetNext() as IModelDoc2;
            }
            string folder = Path.Combine(LocalRoot, "Staging", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(folder);
            string basename = Path.GetFileNameWithoutExtension(model.GetPathName());
            if (basename.Length > 120) basename = basename.Substring(0, 120);
            string destination = Path.Combine(folder, basename + ".zip");
            try
            {
                PackAndGo package = (PackAndGo)model.Extension.GetPackAndGo();
                if (package == null) throw new InvalidOperationException("SOLIDWORKS could not collect the design dependencies.");
                package.IncludeDrawings = true;
                package.IncludeSuppressed = true;
                package.IncludeSimulationResults = false;
                package.FlattenToSingleFolder = false;
                if (!package.SetSaveToName(true, destination)) throw new InvalidOperationException("SOLIDWORKS could not set the package destination.");
                Array results = model.Extension.SavePackAndGo(package) as Array;
                if (results == null || results.Length == 0) throw new InvalidOperationException("Pack and Go returned no file results. Create a package manually to inspect the design references.");
                foreach (object result in results)
                    if (Convert.ToInt32(result) != 0) throw new InvalidOperationException("Pack and Go reported an incomplete file. Resolve missing or inaccessible references before uploading.");
                if (!File.Exists(destination)) throw new InvalidOperationException("Pack and Go did not create the ZIP file.");
                long size = new FileInfo(destination).Length;
                if (size == 0 || size > MaximumBytes) throw new InvalidOperationException("The package must be between 1 byte and 50 MB. Exclude unnecessary data or split the subsystem.");
                return destination;
            }
            catch { try { Directory.Delete(folder, true); } catch { } throw; }
        }

        internal static int DocumentType(string path)
        {
            switch (Path.GetExtension(path).ToLowerInvariant())
            {
                case ".sldprt": return (int)swDocumentTypes_e.swDocPART;
                case ".sldasm": return (int)swDocumentTypes_e.swDocASSEMBLY;
                case ".slddrw": return (int)swDocumentTypes_e.swDocDRAWING;
                default: return 0;
            }
        }

        internal static void Open(ISldWorks application, string file, bool readOnly)
        {
            int type = DocumentType(file);
            if (type == 0) throw new InvalidOperationException("Select a SolidWorks part, assembly, or drawing.");
            int errors = 0, warnings = 0;
            int options = readOnly ? (int)swOpenDocOptions_e.swOpenDocOptions_ReadOnly : 0;
            IModelDoc2 document = application.OpenDoc6(file, type, options, "", ref errors, ref warnings) as IModelDoc2;
            if (document == null || errors != 0) throw new InvalidOperationException("SOLIDWORKS could not fully open the design (error " + errors + "). Check the downloaded package and references.");
            if (warnings != 0) System.Windows.Forms.MessageBox.Show("SOLIDWORKS opened the design with warning code " + warnings + ". Review its references before editing.", "Aero Vault");
        }
    }
}
