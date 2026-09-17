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
[assembly: AssemblyFileVersion("0.2.2.0")]
[assembly: ComVisible(false)]

namespace AeroVault.SolidWorks
{
    // SetAddinCallbackInfo2 marshals the callback object as IDispatch.
    // ISwAddin supplies the lifecycle interface, but is not our dispatch contract.
    [ComVisible(true)]
    [Guid("2EA82EFA-CF98-4605-A864-CF9A74A17F82")]
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IAeroVaultCallbacks
    {
        [DispId(1)]
        int GetCallbackProtocolVersion();
    }

    [ComVisible(true)]
    [Guid("F36E6671-8086-49B1-BD0A-FB8C8DB95072")]
    [ProgId("AeroVault.SolidWorks.AddIn")]
    [ClassInterface(ClassInterfaceType.None)]
    [ComDefaultInterface(typeof(IAeroVaultCallbacks))]
    public sealed class AddIn : ISwAddin, IAeroVaultCallbacks
    {
        private ISldWorks application;
        private ITaskpaneView pane;
        private VaultPanel panel;

        public int GetCallbackProtocolVersion() { return 1; }

        public bool ConnectToSW(object thisSw, int cookie)
        {
            string stage = "Check process architecture";
            try
            {
                if (IntPtr.Size != 8) throw new InvalidOperationException("Aero Vault requires a 64-bit SOLIDWORKS process.");
                stage = "Connect to the SOLIDWORKS application interface";
                application = (ISldWorks)thisSw;
                stage = "Register the SOLIDWORKS add-in callback";
                application.SetAddinCallbackInfo2(0, this, cookie);
                stage = "Create task pane icons";
                string[] icons = CreateIcons();
                stage = "Create the SOLIDWORKS task pane";
                object createdPane = application.CreateTaskpaneView3(icons, "Aero Vault");
                stage = "Connect to the task pane interface";
                pane = (ITaskpaneView)createdPane;
                if (pane == null) throw new InvalidOperationException("SOLIDWORKS could not create the Aero Vault task pane.");
                stage = "Construct the Windows panel and WebView2 control";
                panel = new VaultPanel(application) { Dock = DockStyle.Fill };
                stage = "Create the Windows panel handle";
                long panelHandle = panel.Handle.ToInt64();
                stage = "Attach the Windows panel to the SOLIDWORKS task pane";
                if (!pane.DisplayWindowFromHandlex64(panelHandle))
                    throw new InvalidOperationException("SOLIDWORKS could not attach the Aero Vault panel.");
                stage = "Start the embedded browser";
                panel.Start();
                return true;
            }
            catch (Exception ex)
            {
                string details = RecordStartupFailure(stage, ex);
                DisconnectFromSW();
                MessageBox.Show("Step: " + stage + "\n\n" + ex.GetType().Name + ": " + ex.Message +
                    "\nHRESULT: 0x" + ex.HResult.ToString("X8") + "\n\n" + details,
                    "Aero Vault could not load (diagnostic 0.2.2)", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return false;
            }
        }

        private static string RecordStartupFailure(string stage, Exception error)
        {
            try
            {
                string folder = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.LocalApplicationData), "AeroVault", "Logs");
                Directory.CreateDirectory(folder);
                string path = Path.Combine(folder, "startup-error.txt");
                string report = "Aero Vault startup diagnostic 0.2.2\r\n" + DateTime.UtcNow.ToString("O") +
                    "\r\nStep: " + stage + "\r\nCLR: " + System.Environment.Version +
                    "\r\nProcess bits: " + (IntPtr.Size * 8) +
                    "\r\nArchitecture: " + System.Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") +
                    "\r\nOS: " + System.Environment.OSVersion +
                    "\r\nAdd-in: " + Assembly.GetExecutingAssembly().Location +
                    "\r\nSOLIDWORKS interop: " + typeof(ISldWorks).Assembly.FullName +
                    "\r\nInterop path: " + typeof(ISldWorks).Assembly.Location +
                    "\r\n\r\n" + error.ToString();
                File.WriteAllText(path, report);
                return "Send a screenshot of this dialog. Full error details are saved at:\n" + path;
            }
            catch { return "Send a screenshot of this dialog. The diagnostic file could not be saved."; }
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
