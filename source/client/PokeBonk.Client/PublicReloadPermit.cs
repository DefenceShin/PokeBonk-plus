using System;
using System.Diagnostics;
using System.Threading;

namespace PokeBonk.Client;

internal sealed class PublicReloadPermit
{
	private readonly PublicReloadBoundary _003Cinitial_003EP;
	private readonly CancellationToken _003Ccancellation_003EP;
	private readonly Func<long> clock;

	private readonly long started;

	private readonly long lifetime;

	private ulong? navigation;

	private bool retired;

	internal bool Available
	{
		get
		{
			long num = clock() - started;
			if (!retired && !_003Ccancellation_003EP.IsCancellationRequested && num >= 0)
			{
				return num <= lifetime;
			}
			return false;
		}
	}

	public PublicReloadPermit(PublicReloadBoundary initial, CancellationToken cancellation, Func<long>? timestamp = null, long frequency = 0L)
	{
		_003Cinitial_003EP = initial;
		_003Ccancellation_003EP = cancellation;
		clock = timestamp ?? new Func<long>(Stopwatch.GetTimestamp);
		started = (timestamp ?? new Func<long>(Stopwatch.GetTimestamp))();
		lifetime = checked(((frequency > 0) ? frequency : Stopwatch.Frequency) * 15);
	}

	internal bool Matches(PublicReloadBoundary now)
	{
		if (Available && _003Cinitial_003EP.Requested && _003Cinitial_003EP.Scheduled && !_003Cinitial_003EP.Closing && (_003Cinitial_003EP.ExpectedIdentity == null || _003Cinitial_003EP.ExpectedIdentity == _003Cinitial_003EP.ObservedIdentity) && now.Core == _003Cinitial_003EP.Core && now.Document == _003Cinitial_003EP.Document && now.Intent == _003Cinitial_003EP.Intent && now.Recovery == _003Cinitial_003EP.Recovery && now.ExpectedIdentity == _003Cinitial_003EP.ExpectedIdentity && now.ObservedIdentity == _003Cinitial_003EP.ObservedIdentity && now.Wanted == _003Cinitial_003EP.Wanted && now.Requested && now.Scheduled && !now.Closing)
		{
			if (now.Page != _003Cinitial_003EP.Page)
			{
				if (navigation.HasValue)
				{
					return now.Page == _003Cinitial_003EP.Page + 1;
				}
				return false;
			}
			return true;
		}
		return false;
	}

	internal bool Navigation(PublicReloadBoundary now, string target, ulong id, bool knownReload)
	{
		if (!Matches(now) || target != _003Cinitial_003EP.Document || !knownReload || (navigation.HasValue && navigation != id))
		{
			Retire();
			return false;
		}
		navigation = id;
		return true;
	}

	internal bool Consume(PublicReloadBoundary now, string document, bool beforeUnload)
	{
		if (!beforeUnload || document != _003Cinitial_003EP.Document || !Matches(now))
		{
			return false;
		}
		retired = true;
		return true;
	}

	internal void Retire()
	{
		retired = true;
	}
}
