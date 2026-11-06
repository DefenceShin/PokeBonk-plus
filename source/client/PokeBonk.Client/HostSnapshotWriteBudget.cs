namespace PokeBonk.Client;

internal sealed class HostSnapshotWriteBudget
{
	private long nextAt = long.MinValue;

	private string? boundary;

	internal bool Take(long monotonicMs, string currentBoundary)
	{
		if (boundary == currentBoundary && monotonicMs < nextAt)
		{
			return false;
		}
		boundary = currentBoundary;
		nextAt = monotonicMs + 5000;
		return true;
	}
}
