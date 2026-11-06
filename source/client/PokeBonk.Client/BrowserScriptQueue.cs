using System;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

namespace PokeBonk.Client;

internal sealed class BrowserScriptQueue
{
	private sealed class Lane
	{
		internal readonly object Sync = new object();

		internal Task<string>? Active;
	}

	private readonly ConditionalWeakTable<object, Lane> lanes = new ConditionalWeakTable<object, Lane>();

	internal async Task<string> RunAsync(object owner, Func<Task<string>> execute, TimeSpan timeout, CancellationToken cancellation)
	{
		ArgumentNullException.ThrowIfNull(owner, "owner");
		ArgumentNullException.ThrowIfNull(execute, "execute");
		if (timeout < TimeSpan.Zero && timeout != Timeout.InfiniteTimeSpan)
		{
			throw new ArgumentOutOfRangeException("timeout");
		}
		Lane lane = lanes.GetValue(owner, (object _) => new Lane());
		long started = Stopwatch.GetTimestamp();
		bool firstAttempt = true;
		Task<string> pending;
		while (true)
		{
			cancellation.ThrowIfCancellationRequested();
			TimeSpan timeSpan = Remaining();
			if (!firstAttempt && timeSpan == TimeSpan.Zero)
			{
				throw new TimeoutException("等待已有游戏脚本执行完成超时；未追加原生请求。");
			}
			firstAttempt = false;
			bool flag;
			lock (lane.Sync)
			{
				Task<string> active = lane.Active;
				if (active != null && !active.IsCompleted)
				{
					pending = active;
					flag = false;
				}
				else
				{
					cancellation.ThrowIfCancellationRequested();
					pending = (lane.Active = execute() ?? throw new InvalidOperationException("游戏脚本请求未返回任务。"));
					flag = true;
					pending.ContinueWith(delegate(Task<string> task, object? state)
					{
						if (task.IsFaulted)
						{
							_ = task.Exception;
						}
						Lane lane2 = (Lane)state;
						lock (lane2.Sync)
						{
							if (lane2.Active == task)
							{
								lane2.Active = null;
							}
						}
					}, lane, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
				}
			}
			if (flag)
			{
				break;
			}
			try
			{
				await pending.WaitAsync(Remaining(), cancellation);
			}
			catch when (pending.IsCompleted && !cancellation.IsCancellationRequested)
			{
			}
			pending = null;
		}
		return await pending.WaitAsync(Remaining(), cancellation);
		TimeSpan Remaining()
		{
			if (timeout == Timeout.InfiniteTimeSpan)
			{
				return timeout;
			}
			TimeSpan timeSpan2 = timeout - Stopwatch.GetElapsedTime(started);
			if (!(timeSpan2 > TimeSpan.Zero))
			{
				return TimeSpan.Zero;
			}
			return timeSpan2;
		}
	}
}
