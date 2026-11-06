using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace PokeBonk.Client;

internal sealed class WecomRateBudget
{
	private sealed class Window
	{
		internal readonly Queue<long> Starts = new Queue<long>();

		internal long BlockedUntil;

		internal long Touched;
	}

	private readonly Dictionary<string, Window> windows = new Dictionary<string, Window>(StringComparer.Ordinal);

	private readonly object gate = new object();

	internal static readonly WecomRateBudget Shared = new WecomRateBudget();

	private static string Key(Uri uri)
	{
		return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(uri.AbsoluteUri)));
	}

	internal TimeSpan Reserve(Uri uri, long now)
	{
		lock (gate)
		{
			string key = Key(uri);
			if (!windows.TryGetValue(key, out Window value))
			{
				if (windows.Count >= 128)
				{
					string[] array = (from x in windows
						where now - x.Value.Touched > 120000
						select x.Key).ToArray();
					foreach (string key2 in array)
					{
						windows.Remove(key2);
					}
				}
				if (windows.Count >= 128)
				{
					return TimeSpan.FromMinutes(1.0);
				}
				value = (windows[key] = new Window());
			}
			value.Touched = now;
			while (value.Starts.Count > 0 && now - value.Starts.Peek() >= 60000)
			{
				value.Starts.Dequeue();
			}
			if (value.BlockedUntil > now)
			{
				return TimeSpan.FromMilliseconds(value.BlockedUntil - now);
			}
			if (value.Starts.Count >= 20)
			{
				return TimeSpan.FromMilliseconds(Math.Max(1L, 60000 - (now - value.Starts.Peek())));
			}
			value.Starts.Enqueue(now);
			return TimeSpan.Zero;
		}
	}

	internal void Limit(Uri uri, long now)
	{
		lock (gate)
		{
			string key = Key(uri);
			if (windows.TryGetValue(key, out Window value))
			{
				value.BlockedUntil = Math.Max(value.BlockedUntil, now + 60000);
			}
		}
	}
}
