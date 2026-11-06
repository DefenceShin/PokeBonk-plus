using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace PokeBonk.Client;

internal sealed class BrowserExecutionPower : IDisposable
{
	[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
	private struct ReasonContext
	{
		public uint Version;

		public uint Flags;

		public ReasonUnion Reason;
	}

	private struct DetailedReason
	{
		public nint Module;

		public uint Id;

		public uint Count;

		public nint Strings;
	}

	[StructLayout(LayoutKind.Explicit)]
	private struct ReasonUnion
	{
		[FieldOffset(0)]
		public nint SimpleReasonString;

		[FieldOffset(0)]
		public DetailedReason Detailed;
	}

	private sealed class PowerHandle : SafeHandleZeroOrMinusOneIsInvalid
	{
		public PowerHandle()
			: base(ownsHandle: true)
		{
		}

		protected override bool ReleaseHandle()
		{
			PowerClearRequest(handle, 1);
			return CloseHandle(handle);
		}
	}

	private readonly Func<IDisposable?> acquire;

	private IDisposable? request;

	private bool attempted;

	internal bool Active => request != null;

	internal BrowserExecutionPower(Func<IDisposable?>? acquire = null)
	{
		this.acquire = acquire ?? new Func<IDisposable>(AcquireNative);
	}

	internal static bool ShouldHold(bool optedIn, bool wanted, bool ready, bool failed, bool closing, bool allowed, bool enabled, string? state)
	{
		if (optedIn && wanted && ready && !failed && !closing && allowed && enabled)
		{
			return state != "paused";
		}
		return false;
	}

	internal void Update(bool required)
	{
		if (!required)
		{
			Dispose();
		}
		else if (!attempted)
		{
			attempted = true;
			try
			{
				request = acquire();
			}
			catch (Exception ex) when (((ex is DllNotFoundException || ex is EntryPointNotFoundException || ex is PlatformNotSupportedException || ex is Win32Exception) ? 1 : 0) != 0)
			{
			}
		}
	}

	public void Dispose()
	{
		request?.Dispose();
		request = null;
		attempted = false;
	}

	private static IDisposable? AcquireNative()
	{
		if (!OperatingSystem.IsWindows())
		{
			return null;
		}
		nint num = Marshal.StringToHGlobalUni("PokéBonk旅伴正在执行已启用的挂机任务，暂时请求不自动睡眠");
		try
		{
			ReasonContext context = new ReasonContext
			{
				Version = 0u,
				Flags = 1u,
				Reason = new ReasonUnion
				{
					SimpleReasonString = num
				}
			};
			PowerHandle powerHandle = PowerCreateRequest(ref context);
			if (powerHandle.IsInvalid)
			{
				powerHandle.Dispose();
				return null;
			}
			if (PowerSetRequest(powerHandle, 1))
			{
				return powerHandle;
			}
			powerHandle.Dispose();
			return null;
		}
		finally
		{
			Marshal.FreeHGlobal(num);
		}
	}

	[DllImport("kernel32.dll", ExactSpelling = true, SetLastError = true)]
	private static extern PowerHandle PowerCreateRequest(ref ReasonContext context);

	[DllImport("kernel32.dll", SetLastError = true)]
	[return: MarshalAs(UnmanagedType.Bool)]
	private static extern bool PowerSetRequest(PowerHandle handle, int type);

	[DllImport("kernel32.dll", SetLastError = true)]
	[return: MarshalAs(UnmanagedType.Bool)]
	private static extern bool PowerClearRequest(nint handle, int type);

	[DllImport("kernel32.dll", SetLastError = true)]
	[return: MarshalAs(UnmanagedType.Bool)]
	private static extern bool CloseHandle(nint handle);
}
