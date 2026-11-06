using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Threading;

namespace PokeBonk.Client;

internal sealed class DistributionInstance : IDisposable
{
	internal const string PublicMutexName = "Global\\PokeBonkPilot-PublicInstance-v1";

	internal const string Edition = "public";

	private readonly Mutex? mutex;

	private bool disposed;

	private DistributionInstance(Mutex? mutex)
	{
		this.mutex = mutex;
	}

	internal static DistributionInstance Acquire()
	{
		return AcquireChecked("Global\\PokeBonkPilot-PublicInstance-v1", ReadVisibleProcesses);
	}

	internal static DistributionInstance AcquireChecked(string name, Func<IEnumerable<ClientProcessIdentity>> inspect)
	{
		Mutex mutex = null;
		try
		{
			mutex = new Mutex(initiallyOwned: false, name);
			bool flag;
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
				throw new PublicClientInUseException();
			}
			try
			{
				foreach (ClientProcessIdentity item in inspect())
				{
					if (item.Id != Environment.ProcessId)
					{
						if (IsClient(item))
						{
							throw new PublicClientInUseException();
						}
						if (item.MetadataUnavailable && IsKnownProcessName(item.Name))
						{
							throw new PublicClientInUseException(unableToVerify: true);
						}
					}
				}
			}
			catch
			{
				mutex.ReleaseMutex();
				throw;
			}
			return new DistributionInstance(mutex);
		}
		catch (UnauthorizedAccessException)
		{
			mutex?.Dispose();
			throw new PublicClientInUseException(unableToVerify: true);
		}
		catch
		{
			mutex?.Dispose();
			throw;
		}
	}

	internal static bool IsClient(ClientProcessIdentity process)
	{
		if (string.Equals(process.Product, "PokeBonk Pilot", StringComparison.OrdinalIgnoreCase))
		{
			return string.Equals(process.OriginalFilename, "PokeBonk Pilot.dll", StringComparison.OrdinalIgnoreCase);
		}
		return false;
	}

	private static bool IsKnownProcessName(string? name)
	{
		return string.Equals(name, "PokeBonk Pilot", StringComparison.OrdinalIgnoreCase);
	}

	private static IEnumerable<ClientProcessIdentity> ReadVisibleProcesses()
	{
		Process[] processes = Process.GetProcesses();
		try
		{
			Process[] array = processes;
			foreach (Process process in array)
			{
				if (process.Id != Environment.ProcessId)
				{
					ClientProcessIdentity clientProcessIdentity = ReadIdentity(process);
					if (clientProcessIdentity != null)
					{
						yield return clientProcessIdentity;
					}
				}
			}
		}
		finally
		{
			Process[] array2 = processes;
			for (int j = 0; j < array2.Length; j++)
			{
				array2[j].Dispose();
			}
		}
	}

	internal static ClientProcessIdentity? ReadIdentity(Process process)
	{
		string name = null;
		try
		{
			if (process.HasExited)
			{
				return null;
			}
			name = process.ProcessName;
			string text = process.MainModule?.FileName;
			if (text == null)
			{
				return new ClientProcessIdentity(process.Id, name, null, null, null, MetadataUnavailable: true);
			}
			FileVersionInfo versionInfo = FileVersionInfo.GetVersionInfo(text);
			return new ClientProcessIdentity(process.Id, name, text, versionInfo.ProductName, versionInfo.OriginalFilename);
		}
		catch (InvalidOperationException)
		{
			return null;
		}
		catch (ArgumentException)
		{
			return null;
		}
		catch (Exception ex3) when (((ex3 is Win32Exception || ex3 is UnauthorizedAccessException || ex3 is IOException || ex3 is NotSupportedException) ? 1 : 0) != 0)
		{
			return new ClientProcessIdentity(process.Id, name, null, null, null, MetadataUnavailable: true);
		}
	}

	public void Dispose()
	{
		if (!disposed)
		{
			disposed = true;
			if (mutex != null)
			{
				mutex.ReleaseMutex();
				mutex.Dispose();
			}
		}
	}
}
