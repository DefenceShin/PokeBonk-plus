using System;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace PokeBonk.Client;

internal sealed class WecomDpapi : IWecomProtector
{
	private struct Blob
	{
		internal int Size;

		internal nint Data;
	}

	[DllImport("crypt32.dll", SetLastError = true)]
	private static extern bool CryptProtectData(ref Blob input, string? description, nint entropy, nint reserved, nint prompt, uint flags, out Blob output);

	[DllImport("crypt32.dll", SetLastError = true)]
	private static extern bool CryptUnprotectData(ref Blob input, nint description, nint entropy, nint reserved, nint prompt, uint flags, out Blob output);

	[DllImport("kernel32.dll")]
	private static extern nint LocalFree(nint data);

	private static byte[] Transform(byte[] bytes, bool encrypt)
	{
		if (!OperatingSystem.IsWindows())
		{
			throw new CryptographicException("仅支持当前Windows用户的密钥保护");
		}
		Blob input = new Blob
		{
			Size = bytes.Length,
			Data = Marshal.AllocHGlobal(bytes.Length)
		};
		Blob output = default(Blob);
		try
		{
			Marshal.Copy(bytes, 0, input.Data, bytes.Length);
			if (!(encrypt ? CryptProtectData(ref input, "PokeBonk WeCom local target", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1u, out output) : CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1u, out output)))
			{
				throw new CryptographicException("本机密钥无法解密，请重新配置接收目标");
			}
			byte[] array = new byte[output.Size];
			Marshal.Copy(output.Data, array, 0, output.Size);
			return array;
		}
		finally
		{
			if (input.Data != IntPtr.Zero)
			{
				for (int i = 0; i < input.Size; i++)
				{
					Marshal.WriteByte(input.Data, i, 0);
				}
				Marshal.FreeHGlobal(input.Data);
			}
			if (output.Data != IntPtr.Zero)
			{
				LocalFree(output.Data);
			}
		}
	}

	public byte[] Protect(byte[] plain)
	{
		return Transform(plain, encrypt: true);
	}

	public byte[] Unprotect(byte[] cipher)
	{
		return Transform(cipher, encrypt: false);
	}
}
