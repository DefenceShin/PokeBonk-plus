namespace PokeBonk.Client;

internal sealed class ClientRegionProgress
{
	private string run = "";

	private string region = "";

	private int elapsed = -1;

	internal bool Advance(string runKey, string regionKey, int nativeElapsed)
	{
		if (run != runKey || elapsed < 0)
		{
			run = runKey;
			region = regionKey;
			elapsed = nativeElapsed;
			return false;
		}
		if (nativeElapsed < elapsed)
		{
			return false;
		}
		elapsed = nativeElapsed;
		if (region == regionKey)
		{
			return false;
		}
		region = regionKey;
		return true;
	}
}
