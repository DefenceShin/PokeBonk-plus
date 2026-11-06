using System.Linq;
using System.Text.Json.Nodes;

namespace PokeBonk.Client;

internal readonly record struct RestReminderState(string Token, double RemainingMilliseconds)
{
	internal const double MaximumMilliseconds = 1800000.0;

	internal static bool TryRead(JsonNode? value, out RestReminderState state)
	{
		state = default(RestReminderState);
		if (!(value is JsonObject jsonObject) || !(jsonObject["active"] is JsonValue jsonValue) || !jsonValue.TryGetValue<bool>(out var value2) || !value2 || !(jsonObject["token"] is JsonValue jsonValue2) || !jsonValue2.TryGetValue<string>(out string value3) || string.IsNullOrWhiteSpace(value3) || value3.Length > 160 || value3.Any(char.IsControl) || !(jsonObject["remainingMs"] is JsonValue jsonValue3) || !jsonValue3.TryGetValue<double>(out var value4) || !double.IsFinite(value4) || value4 < 0.0 || value4 > 1800000.0)
		{
			return false;
		}
		state = new RestReminderState(value3, value4);
		return true;
	}
}
