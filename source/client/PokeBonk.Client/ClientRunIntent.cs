using System;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PokeBonk.Client;

internal static class ClientRunIntent
{
	internal static void RequireCurrent(string action, JsonObject payload, long generation)
	{
		bool flag = ((action == "start" || action == "resume") ? true : false);
		if (!flag || !payload.ContainsKey("expectedIntentGeneration") || (payload["expectedIntentGeneration"] is JsonValue jsonValue && jsonValue.GetValueKind() == JsonValueKind.Number && long.TryParse(jsonValue.ToJsonString(), NumberStyles.None, CultureInfo.InvariantCulture, out var result) && result >= 0 && result == generation))
		{
			return;
		}
		throw new OperationCanceledException("等待设置期间运行意图已变化，本次开始已取消");
	}
}
