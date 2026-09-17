using System;
using System.Runtime.InteropServices;
using AeroVault.SolidWorks;
using SolidWorks.Interop.swpublished;

internal static class CallbackTests
{
    [STAThread]
    private static int Main()
    {
        IntPtr dispatch = IntPtr.Zero, lifecycle = IntPtr.Zero, callback = IntPtr.Zero;
        AddIn addin = null;
        try
        {
            // Test the actual built class, without starting SOLIDWORKS or a browser.
            // The old ClassInterface.None / ISwAddin-only class fails to expose IDispatch.
            addin = new AddIn();
            dispatch = Marshal.GetIDispatchForObject(addin);
            lifecycle = Marshal.GetComInterfaceForObject(addin, typeof(ISwAddin));
            Guid callbackId = typeof(IAeroVaultCallbacks).GUID;
            int result = Marshal.QueryInterface(dispatch, ref callbackId, out callback);
            Marshal.ThrowExceptionForHR(result);
            if (dispatch == IntPtr.Zero || lifecycle == IntPtr.Zero || callback == IntPtr.Zero)
                throw new Exception("The add-in did not expose both lifecycle and callback interfaces.");
            Console.WriteLine("PASS: compiled add-in exposes IDispatch, the callback interface, and ISwAddin.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally
        {
            if (callback != IntPtr.Zero) Marshal.Release(callback);
            if (lifecycle != IntPtr.Zero) Marshal.Release(lifecycle);
            if (dispatch != IntPtr.Zero) Marshal.Release(dispatch);
            GC.KeepAlive(addin);
        }
    }
}
