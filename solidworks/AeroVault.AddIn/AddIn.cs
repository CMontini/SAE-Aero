using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Win32;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swpublished;

[assembly: AssemblyTitle("Aero Vault for SOLIDWORKS")]
[assembly: AssemblyVersion("0.2.0.0")]
[assembly: ComVisible(false)]

namespace AeroVault.SolidWorks
{
    [ComVisible(true)]
    [Guid("F36E6671-8086-49B1-BD0A-FB8C8DB95072")]
    [ProgId("AeroVault.SolidWorks.AddIn")]
    [ClassInterface(ClassInterfaceType.None)]
    public sealed class AddIn : ISwAddin
    {
        private ISldWorks application;
        private ITaskpaneView pane;
        private VaultPanel panel;

        public bool ConnectToSW(object thisSw, int cookie)
        {
            try
            {
                if (IntPtr.Size != 8) throw new InvalidOperationException("Aero Vault requires a 64-bit SOLIDWORKS process.");
                application = (ISldWorks)thisSw;
                application.SetAddinCallbackInfo2(0, this, cookie);
                pane = (ITaskpaneView)application.CreateTaskpaneView3(CreateIcons(), "Aero Vault");
                if (pane == null) throw new InvalidOperationException("SOLIDWORKS could not create the Aero Vault task pane.");
                panel = new VaultPanel(application) { Dock = DockStyle.Fill };
                if (!pane.DisplayWindowFromHandlex64(panel.Handle.ToInt64()))
                    throw new InvalidOperationException("SOLIDWORKS could not attach the Aero Vault panel.");
                panel.Start();
                return true;
            }
            catch (Exception ex)
            {
                DisconnectFromSW();
                MessageBox.Show(ex.Message, "Aero Vault could not load", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return false;
            }
        }

        public bool DisconnectFromSW()
        {
            try { if (panel != null) panel.Dispose(); } catch { }
            try { if (pane != null) pane.DeleteView(); } catch { }
            panel = null;
            pane = null;
            application = null;
            return true;
        }

        private static string[] CreateIcons()
        {
            string root = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData), "AeroVault", "Icons");
            Directory.CreateDirectory(root);
            int[] sizes = { 20, 32, 40, 64, 96, 128 };
            string[] paths = new string[sizes.Length];
            for (int i = 0; i < sizes.Length; i++)
            {
                paths[i] = Path.Combine(root, "aero-" + sizes[i] + ".png");
                using (Bitmap bitmap = new Bitmap(sizes[i], sizes[i]))
                using (Graphics graphics = Graphics.FromImage(bitmap))
                using (Font font = new Font("Segoe UI", sizes[i] * 0.65f, FontStyle.Bold, GraphicsUnit.Pixel))
                using (Brush brush = new SolidBrush(Color.FromArgb(121, 162, 255)))
                {
                    graphics.Clear(Color.FromArgb(16, 31, 54));
                    graphics.DrawString("A", font, brush, new RectangleF(0, 0, sizes[i], sizes[i]), new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center });
                    bitmap.Save(paths[i], System.Drawing.Imaging.ImageFormat.Png);
                }
            }
            return paths;
        }

        [ComRegisterFunction]
        public static void Register(Type type)
        {
            using (RegistryKey machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
            using (RegistryKey key = machine.CreateSubKey(@"SOFTWARE\SolidWorks\Addins\{" + type.GUID + "}"))
            {
                key.SetValue(null, 0, RegistryValueKind.DWord);
                key.SetValue("Title", "Aero Vault");
                key.SetValue("Description", "Team design packages, checkout, and revision history. Pilot build for SOLIDWORKS 2026.");
            }
            // First load is explicit in Tools > Add-Ins. Do not enable startup automatically.
        }

        [ComUnregisterFunction]
        public static void Unregister(Type type)
        {
            using (RegistryKey machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                machine.DeleteSubKeyTree(@"SOFTWARE\SolidWorks\Addins\{" + type.GUID + "}", false);
            using (RegistryKey user = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, RegistryView.Registry64))
                user.DeleteSubKeyTree(@"SOFTWARE\SolidWorks\AddInsStartup\{" + type.GUID + "}", false);
        }
    }
}
