using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace PokeBonk.Client;

internal static class TowerSettings
{
	internal static readonly string[] StrategyFields = new string[] { "tombExperienceFloor", "onlyExperience", "saveMoneyAfter50", "aggressiveUltimate", "experienceBlessingPriority", "cursePriority", "trickPolicy", "rewardFocus", "vitaminFocus", "supportFocus", "itemPriorities", "vitaminPriorities", "pactPolicy", "pactPriorities", "shopPolicy" };

	private static readonly Dictionary<string, string[]> Choices = new Dictionary<string, string[]>
	{
		["trickPolicy"] = new string[3] { "inherit", "treat", "trick" },
		["rewardFocus"] = new string[5] { "inherit", "damage", "survival", "growth", "control" },
		["vitaminFocus"] = new string[5] { "inherit", "damage", "survival", "growth", "dodge" },
		["supportFocus"] = new string[4] { "inherit", "damage", "status", "survival" },
		["pactPolicy"] = new string[3] { "inherit", "avoid", "auto" },
		["shopPolicy"] = new string[3] { "inherit", "useful", "preferred" }
	};

	internal static JsonObject Defaults()
	{
		JsonObject jsonObject = new JsonObject
		{
			["biome"] = "auto",
			["tier"] = "auto",
			["exitPolicy"] = "clear",
			["tombExperienceFloor"] = 0, ["onlyExperience"] = false, ["saveMoneyAfter50"] = false, ["aggressiveUltimate"] = false, ["experienceBlessingPriority"] = false, ["cursePriority"] = "auto",
			["noCandles"] = false
		};
		foreach (KeyValuePair<string, string[]> choice in Choices)
		{
			jsonObject[choice.Key] = "inherit";
		}
		string[] array = new string[3] { "itemPriorities", "vitaminPriorities", "pactPriorities" };
		foreach (string text in array)
		{
			jsonObject[text] = new JsonArray(Enumerable.Range(0, (text == "vitaminPriorities") ? 5 : 10).Select((Func<int, JsonNode>)((int _) => JsonValue.Create(""))).ToArray());
		}
		return jsonObject;
	}

	internal static void Assign(JsonObject route, string field, JsonNode? value)
	{
        if (field == "tombExperienceFloor") {
            route[field] = value is JsonValue v && v.TryGetValue<int>(out var floor) && floor is >= 1 and <= 100 ? floor : 0;
            return;
        }
        if (field is "onlyExperience" or "saveMoneyAfter50" or "aggressiveUltimate" or "experienceBlessingPriority") {
            route[field] = value?.GetValueKind() == JsonValueKind.True; return;
        }
        if (field == "cursePriority") {
            string[] known = ["hunger", "iron", "dark", "graves", "swift", "twin"];
            var preferred = value is JsonArray entries ? entries
                .Where(entry => entry?.GetValueKind() == JsonValueKind.String)
                .Select(entry => entry!.GetValue<string>()).Where(known.Contains).Distinct().ToArray() : [];
            route[field] = preferred.Length == 0 ? JsonValue.Create("auto") :
                new JsonArray(preferred.Concat(known.Except(preferred)).Select(id => (JsonNode?)JsonValue.Create(id)).ToArray());
            return;
        }
		if (Choices.TryGetValue(field, out string[] value2))
		{
			route[field] = ((value != null && value.GetValueKind() == JsonValueKind.String && value2.Contains(value.GetValue<string>())) ? value.GetValue<string>() : "inherit");
			return;
		}
		bool flag;
		switch (field)
		{
		case "itemPriorities":
		case "vitaminPriorities":
		case "pactPriorities":
			flag = true;
			break;
		default:
			flag = false;
			break;
		}
		if (flag)
		{
			JsonArray jsonArray = new JsonArray();
			HashSet<string> hashSet = new HashSet<string>(StringComparer.Ordinal);
			JsonArray jsonArray2 = ((field == "pactPriorities") ? CostSettings.Priorities(value) : (value as JsonArray));
			for (int i = 0; i < ((field == "vitaminPriorities") ? 5 : 10); i++)
			{
				JsonNode jsonNode = ((jsonArray2 != null && i < jsonArray2.Count) ? jsonArray2[i] : null);
				string text = ((jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.String) ? jsonNode.GetValue<string>() : "");
				jsonArray.Add(JsonValue.Create((Regex.IsMatch(text, "^[A-Za-z][A-Za-z0-9_-]{0,99}$") && hashSet.Add(text)) ? text : ""));
			}
			route[field] = jsonArray;
		}
	}
}
