using System;
using System.Collections.Generic;

namespace PokeBonk.Client;

internal sealed class ClientObservationIds
{
	private readonly HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);

	private readonly Queue<string> order = new Queue<string>();

	private readonly int capacity;

	internal int Count => seen.Count;

	internal ClientObservationIds(int capacity = 4096)
	{
		if (capacity < 300)
		{
			throw new ArgumentOutOfRangeException("capacity");
		}
		this.capacity = capacity;
	}

	internal bool Add(string id)
	{
		if (!seen.Add(id))
		{
			return false;
		}
		order.Enqueue(id);
		if (order.Count > capacity)
		{
			seen.Remove(order.Dequeue());
		}
		return true;
	}
}
