using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace PokeBonk.Client;

internal static class FinalMoveSettings
{
	internal const string EmptyTarget = "pb:empty-slot";

	private static bool Enabled(JsonNode? node)
	{
		if (node == null)
		{
			return false;
		}
		return node["enabled"]?.GetValueKind() == JsonValueKind.True;
	}

	internal static bool IsUnified(JsonNode? node)
	{
		if (node is JsonObject jsonObject)
		{
			JsonNode? jsonNode = jsonObject["schemaVersion"];
			if (jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.Number && double.TryParse(jsonObject["schemaVersion"].ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var result))
			{
				return result == 2.0;
			}
		}
		return false;
	}

	private static JsonObject Clean(JsonNode? raw, bool duplicates = false)
	{
		raw = raw as JsonObject;
		HashSet<string> hashSet = new HashSet<string>(StringComparer.Ordinal);
		JsonArray jsonArray = new JsonArray();
		object obj;
		string text;
		for (int i = 0; i < 4; text = (string)obj, jsonArray.Add((text != null && Regex.IsMatch(text, "^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,99}$") && (text == "pb:empty-slot" || duplicates || hashSet.Add(text))) ? JsonValue.Create(text) : null), i++)
		{
			if (raw?["targets"] is JsonArray jsonArray2 && i < jsonArray2.Count)
			{
				JsonNode? jsonNode = jsonArray2[i];
				if (jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.String)
				{
					obj = jsonArray2[i].GetValue<string>();
					continue;
				}
			}
			obj = null;
		}
		int num = 30;
		if (raw != null && raw["level"]?.GetValueKind() == JsonValueKind.Number && double.TryParse(raw["level"].ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var result) && double.IsFinite(result))
		{
			num = (int)Math.Clamp(Math.Truncate(result), 1.0, 999999.0);
		}
		JsonObject jsonObject = new JsonObject
		{
			["enabled"] = Enabled(raw),
			["level"] = num,
			["targets"] = jsonArray
		};
		if (raw?["banishLevels"] is JsonArray jsonArray3)
		{
			JsonArray jsonArray4 = new JsonArray();
			int num2;
			int value;
			for (int j = 0; j < 4; value = num2, jsonArray4.Add(value), j++)
			{
				if (j < jsonArray3.Count)
				{
					JsonNode? jsonNode2 = jsonArray3[j];
					if (jsonNode2 != null && jsonNode2.GetValueKind() == JsonValueKind.Number && double.TryParse(jsonArray3[j].ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var result2) && double.IsFinite(result2))
					{
						num2 = (int)Math.Clamp(Math.Truncate(result2), 0.0, 10.0);
						continue;
					}
				}
				num2 = 0;
			}
			jsonObject["banishLevels"] = jsonArray4;
		}
		return jsonObject;
	}

	private static IEnumerable<string> Keys(JsonNode? row)
	{
		return (from value in (row?["targets"] as JsonArray)?.OfType<JsonValue>()
			select value.GetValue<string>()) ?? Array.Empty<string>();
	}

	public static JsonObject Normalize(JsonObject entry)
	{
		if (entry["moves"] is JsonObject jsonObject && IsUnified(jsonObject))
		{
			JsonObject jsonObject2 = Clean(jsonObject, duplicates: true);
			jsonObject2["schemaVersion"] = 2;
			if (jsonObject["migration"] is JsonObject jsonObject3)
			{
				JsonNode? jsonNode = jsonObject3["kind"];
				if (jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.String && jsonObject3["kind"].GetValue<string>() == "legacy-split")
				{
					JsonObject obj = new JsonObject
					{
						["kind"] = "legacy-split",
						["moves"] = Clean(jsonObject3["moves"]),
						["fusion"] = Clean(jsonObject3["fusion"])
					};
					JsonNode? jsonNode2 = jsonObject3["acknowledged"];
					obj["acknowledged"] = jsonNode2 != null && jsonNode2.GetValueKind() == JsonValueKind.True;
					jsonObject2["migration"] = obj;
				}
			}
			return jsonObject2;
		}
		JsonObject jsonObject4 = Clean(entry["moves"]);
		JsonObject jsonObject5 = Clean(entry["fusion"]);
		bool enabled = Enabled(jsonObject4) || Enabled(jsonObject5);
		JsonObject[] array = (enabled ? new JsonObject[2] { jsonObject5, jsonObject4 }.Where(Enabled).ToArray() : new JsonObject[2] { jsonObject5, jsonObject4 });
		JsonObject[] array2 = array.Where((JsonObject row) => Keys(row).Any()).ToArray();
		JsonObject jsonObject6 = ((array.Length == 1) ? array[0] : ((array2.Length == 1) ? array2[0] : null));
		string[] array3 = array.SelectMany(Keys).Distinct<string>(StringComparer.Ordinal).ToArray();
		int num = (from row in array
			where (!enabled) ? Keys(row).Any() : Enabled(row)
			select row["level"].GetValue<int>()).DefaultIfEmpty(30).Max();
		JsonArray jsonArray = new JsonArray();
		for (int num2 = 0; num2 < 4; num2++)
		{
			jsonArray.Add((jsonObject6 != null) ? jsonObject6["targets"][num2]?.DeepClone() : ((num2 < array3.Length) ? JsonValue.Create(array3[num2]) : null));
		}
		JsonObject jsonObject7 = new JsonObject
		{
			["schemaVersion"] = 2,
			["enabled"] = enabled,
			["level"] = num,
			["targets"] = jsonArray
		};
		if (enabled || Keys(jsonObject4).Any() || Keys(jsonObject5).Any())
		{
			jsonObject7["migration"] = new JsonObject
			{
				["kind"] = "legacy-split",
				["moves"] = jsonObject4,
				["fusion"] = jsonObject5,
				["acknowledged"] = false
			};
		}
		return jsonObject7;
	}
}
