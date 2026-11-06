using System;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PokeBonk.Client;

internal static class TimedBehaviorSettings
{
	private static int Seconds(JsonNode? node)
	{
		if (node == null || node.GetValueKind() != JsonValueKind.Number || !double.TryParse(node.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var result) || !double.IsFinite(result) || result != Math.Truncate(result) || !(result >= 0.0) || !(result <= 604800.0))
		{
			return 600;
		}
		return (int)result;
	}

	internal static void Normalize(JsonObject value)
	{
		JsonNode? jsonNode = value["noInteractionsAfter"];
		value["noInteractionsAfter"] = jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.True;
		JsonNode? jsonNode2 = value["fullMapOrbit"];
		value["fullMapOrbit"] = jsonNode2 != null && jsonNode2.GetValueKind() == JsonValueKind.True;
		value["noInteractionsAfterSeconds"] = Seconds(value["noInteractionsAfterSeconds"]);
		value["fullMapOrbitAfterSeconds"] = Seconds(value["fullMapOrbitAfterSeconds"]);
	}
}
