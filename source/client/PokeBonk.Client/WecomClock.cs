using System;

namespace PokeBonk.Client;

internal sealed class WecomClock : IWecomClock
{
	public DateTimeOffset Now => DateTimeOffset.UtcNow;

	public long Milliseconds => Environment.TickCount64;
}
