namespace PokeBonk.Client;

internal sealed class BrowserStartupState
{
	private object? gameView;

	private object? panelView;

	private long revision;

	private long navigationGeneration;

	private bool failed;

	private bool navigationIssued;

	internal bool Completed { get; private set; }

	internal string Stage { get; private set; } = "尚未开始";

	internal long Begin(object game, object panel, long generation)
	{
		revision++;
		gameView = game;
		panelView = panel;
		navigationGeneration = generation;
		bool flag = (Completed = false);
		failed = (navigationIssued = flag);
		Stage = "读取本地资源";
		return revision;
	}

	internal bool Current(object game, object panel, long expected)
	{
		if (expected == revision && gameView == game)
		{
			return panelView == panel;
		}
		return false;
	}

	internal void At(object game, object panel, long expected, string stage)
	{
		if (Current(game, panel, expected))
		{
			Stage = stage;
		}
	}

	internal void Fail(object game, object panel, long expected)
	{
		if (Current(game, panel, expected))
		{
			failed = true;
		}
	}

	internal void Navigating(object game)
	{
		if (gameView == game)
		{
			navigationIssued = true;
		}
	}

	internal void Complete(object game, object panel, long expected)
	{
		if (Current(game, panel, expected))
		{
			Completed = true;
			failed = false;
			Stage = "已就绪";
		}
	}

	internal bool CanRetryFresh(object currentGame, long currentGeneration, string? coreSource, bool observedGame)
	{
		bool flag = failed && !Completed && !navigationIssued && gameView == currentGame && navigationGeneration == currentGeneration && !observedGame;
		if (flag)
		{
			bool flag2 = ((coreSource == null || (coreSource != null && coreSource.Length == 0) || coreSource == "about:blank") ? true : false);
			flag = flag2;
		}
		return flag;
	}

	internal void Invalidate()
	{
		revision++;
		gameView = (panelView = null);
		bool flag = (Completed = false);
		failed = (navigationIssued = flag);
		Stage = "实例已更换";
	}
}
