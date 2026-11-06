using System;

namespace PokeBonk.Client;

internal interface IWecomClock
{
	DateTimeOffset Now { get; }

	long Milliseconds { get; }
}
