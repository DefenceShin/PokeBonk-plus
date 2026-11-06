using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace PokeBonk.Client;

internal sealed class PortableInstance : IDisposable
{
	private readonly FileStream lease;

	private readonly List<Mutex> previousVersionLeases;

	private readonly SafeFileHandle directoryLease;

	private bool disposed;

	private PortableInstance(FileStream lease, List<Mutex> previousVersionLeases, SafeFileHandle directoryLease)
	{
		this.lease = lease;
		this.previousVersionLeases = previousVersionLeases;
		this.directoryLease = directoryLease;
	}

	internal static PortableInstance Acquire(string executableDirectory)
	{
		string text = Path.TrimEndingDirectorySeparator(Path.GetFullPath(executableDirectory));
		PortableStorage.ValidatePathInRoot(text, text);
		if (!Directory.Exists(text))
		{
			throw new IOException("客户端目录不存在。");
		}
		string path = PortableStorage.ValidatePathInRoot(text, Path.Combine(text, ".client-instance.lock"));
		FileStream fileStream;
		try
		{
			fileStream = new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
		}
		catch (IOException ex) when ((uint)((ex.HResult & 0xFFFF) - 32) <= 1u)
		{
			throw new PortableInstanceInUseException();
		}
		List<Mutex> list = new List<Mutex>();
		SafeFileHandle safeFileHandle = null;
		try
		{
			safeFileHandle = PortableIsolation.OpenDirectory(text);
			if (OperatingSystem.IsWindows())
			{
				string[] array = new string[2] { "", "smoke" };
				foreach (string path2 in array)
				{
					string text2 = Path.Combine(text, "data", path2);
					string text3 = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text2.ToUpperInvariant()))).Substring(0, 16);
					Mutex mutex = new Mutex(initiallyOwned: false, "Local\\PokeBonkPilot-" + text3);
					bool flag = false;
					try
					{
						flag = mutex.WaitOne(0);
					}
					catch (AbandonedMutexException)
					{
						flag = true;
					}
					if (!flag)
					{
						mutex.Dispose();
						throw new PortableInstanceInUseException();
					}
					list.Add(mutex);
				}
			}
			return new PortableInstance(fileStream, list, safeFileHandle);
		}
		catch
		{
			foreach (Mutex item in list)
			{
				item.ReleaseMutex();
				item.Dispose();
			}
			safeFileHandle?.Dispose();
			fileStream.Dispose();
			throw;
		}
	}

	public void Dispose()
	{
		if (disposed)
		{
			return;
		}
		disposed = true;
		foreach (Mutex previousVersionLease in previousVersionLeases)
		{
			previousVersionLease.ReleaseMutex();
			previousVersionLease.Dispose();
		}
		directoryLease.Dispose();
		lease.Dispose();
	}
}
