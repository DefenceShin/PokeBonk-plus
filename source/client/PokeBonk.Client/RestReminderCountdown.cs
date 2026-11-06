using System;
using System.Globalization;

namespace PokeBonk.Client;

internal sealed class RestReminderCountdown
{
	private double deadline;

	private bool initialized;

	internal void Observe(double remainingMilliseconds, double monotonicMilliseconds)
	{
		if (!double.IsFinite(remainingMilliseconds) || remainingMilliseconds < 0.0 || remainingMilliseconds > 1800000.0 || !double.IsFinite(monotonicMilliseconds))
		{
			throw new ArgumentOutOfRangeException();
		}
		double num = monotonicMilliseconds + remainingMilliseconds;
		deadline = (initialized ? Math.Min(deadline, num) : num);
		initialized = true;
	}

	internal double Remaining(double monotonicMilliseconds)
	{
		if (!initialized || !double.IsFinite(monotonicMilliseconds))
		{
			return 0.0;
		}
		return Math.Max(0.0, deadline - monotonicMilliseconds);
	}

	internal static string Display(double remainingMilliseconds)
	{
		int num = (double.IsFinite(remainingMilliseconds) ? ((int)Math.Ceiling(Math.Clamp(remainingMilliseconds, 0.0, 1800000.0) / 1000.0)) : 0);
		return (num / 60).ToString("00", CultureInfo.InvariantCulture) + ":" + (num % 60).ToString("00", CultureInfo.InvariantCulture);
	}
}
