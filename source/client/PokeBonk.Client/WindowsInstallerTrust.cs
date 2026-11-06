using System;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;

namespace PokeBonk.Client;

internal static class WindowsInstallerTrust
{
	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
	private struct TrustFile
	{
		public uint Size;

		[MarshalAs(UnmanagedType.LPWStr)]
		public string Path;

		public nint File;

		public nint KnownSubject;
	}

	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
	private struct TrustData
	{
		public uint Size;

		public nint PolicyCallback;

		public nint SipClient;

		public uint UiChoice;

		public uint RevocationChecks;

		public uint UnionChoice;

		public nint FileInfo;

		public uint StateAction;

		public nint StateData;

		public nint UrlReference;

		public uint ProviderFlags;

		public uint UiContext;

		public nint SignatureSettings;
	}

	internal static PrerequisiteSignature Verify(string path)
	{
		if (!OperatingSystem.IsWindows())
		{
			return new PrerequisiteSignature(Valid: false, "", "", "当前系统不是 Windows。");
		}
		TrustFile structure = new TrustFile
		{
			Size = (uint)Marshal.SizeOf<TrustFile>(),
			Path = path
		};
		nint num = Marshal.AllocHGlobal(Marshal.SizeOf<TrustFile>());
		try
		{
			Marshal.StructureToPtr(structure, num, fDeleteOld: false);
			TrustData data = new TrustData
			{
				Size = (uint)Marshal.SizeOf<TrustData>(),
				UiChoice = 2u,
				UnionChoice = 1u,
				FileInfo = num,
				StateAction = 1u,
				ProviderFlags = 4096u
			};
			Guid action = new Guid("00AAC56B-CD44-11D0-8CC2-00C04FC295EE");
			int num2;
			try
			{
				num2 = WinVerifyTrust(new IntPtr(-1), ref action, ref data);
			}
			finally
			{
				data.StateAction = 2u;
				WinVerifyTrust(new IntPtr(-1), ref action, ref data);
			}
			if (num2 != 0)
			{
				return new PrerequisiteSignature(Valid: false, "", "", $"Windows 签名校验：0x{num2:X8}。");
			}
			using X509Certificate2 x509Certificate = new X509Certificate2(X509Certificate.CreateFromSignedFile(path));
			return new PrerequisiteSignature(Valid: true, x509Certificate.GetNameInfo(X509NameType.SimpleName, forIssuer: false), x509Certificate.Thumbprint);
		}
		finally
		{
			Marshal.DestroyStructure<TrustFile>(num);
			Marshal.FreeHGlobal(num);
		}
	}

	[DllImport("wintrust.dll", ExactSpelling = true)]
	private static extern int WinVerifyTrust(nint window, ref Guid action, ref TrustData data);
}
