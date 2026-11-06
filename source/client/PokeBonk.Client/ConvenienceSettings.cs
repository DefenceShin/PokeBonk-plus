using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace PokeBonk.Client;

internal static class ConvenienceSettings
{
	internal static readonly string[] Groups = new string[6] { "rhythm", "fusion", "quantity", "alerts", "coop", "recommendations" };

	internal static readonly string[] CoopExclusions = new string[26]
	{
		"Chest", "FreeChest", "Altar", "Challenge", "Cursed", "CursedChest", "Greed", "Meowth", "Ditto", "Hypno",
		"Snorlax", "Magnet", "Berry", "Boss", "Shrine", "Portal", "Cage", "Rock", "Shroom", "Slots",
		"Bill", "Fossil", "Nest", "Porygon", "Rhydon", "Tower"
	};

	internal static readonly string[] AlertEvents = new string[11]
	{
		"boss", "rare", "downed", "revive", "teammateDown", "stage", "ultimate", "lowHealth", "matchEnd", "saveFailure",
		"fusionReady"
	};

	internal static readonly string[] Tones = new string[4] { "chime", "bell", "soft", "pulse" };

	private static readonly (string Group, string Key, int Minimum, int Maximum)[] Numbers = new(string, string, int, int)[15]
	{
		("rhythm", "randomDelayMinMs", 0, 30000),
		("rhythm", "randomDelayMaxMs", 0, 30000),
		("rhythm", "betweenRunWaitMinSeconds", 0, 86400),
		("rhythm", "betweenRunWaitMaxSeconds", 0, 86400),
		("fusion", "fontSize", 10, 20),
		("fusion", "rowsPerCard", 1, 12),
		("fusion", "cycleSeconds", 3, 20),
		("fusion", "offsetX", -240, 240),
		("fusion", "gap", 0, 48),
		("quantity", "fontSize", 10, 24),
		("alerts", "volume", 0, 100),
		("alerts", "cooldownSeconds", 3, 120),
		("alerts", "lowHealthPercent", 5, 75),
		("recommendations", "fontSize", 10, 24),
		("recommendations", "opacity", 20, 100)
	};

	private static IEnumerable<string> BooleanKeys(string group)
	{
		return group switch
		{
			"rhythm" => new _003C_003Ez__ReadOnlyArray<string>(new string[5] { "enabled", "randomDelay", "betweenRunWait", "inspectPanel", "activationSchedule" }), 
			"coop" => new string[2] { "enabled", "waitPortal" }.Concat(CoopExclusions.Select((string key) => "doNot" + key)), 
			"fusion" => new _003C_003Ez__ReadOnlyArray<string>(new string[4] { "enabled", "showLevels", "showLocks", "onlyHeldPartners" }), 
			"quantity" => new _003C_003Ez__ReadOnlyArray<string>(new string[4] { "enabled", "showLimit", "showVitamins", "compactNumbers" }), 
			"recommendations" => new _003C_003Ez__ReadOnlyArray<string>(new string[6] { "enabled", "showReasons", "showMoves", "showVitamins", "showItems", "showOther" }), 
			_ => new _003C_003Ez__ReadOnlySingleElementList<string>("enabled"), 
		};
	}

	private static bool Boolean(JsonNode? node)
	{
		JsonValueKind? jsonValueKind = node?.GetValueKind();
		if (jsonValueKind.HasValue)
		{
			JsonValueKind valueOrDefault = jsonValueKind.GetValueOrDefault();
			if (valueOrDefault - 5 <= JsonValueKind.Object)
			{
				return true;
			}
		}
		return false;
	}

	internal static JsonObject Defaults()
	{
		JsonObject jsonObject = new JsonObject();
		string[] groups = Groups;
		foreach (string text in groups)
		{
			jsonObject[text] = new JsonObject(from key in BooleanKeys(text)
				select KeyValuePair.Create(key, (JsonNode)JsonValue.Create(value: false)));
		}
		groups = new string[4] { "enabled", "randomDelay", "betweenRunWait", "inspectPanel" };
		foreach (string propertyName in groups)
		{
			jsonObject["rhythm"][propertyName] = true;
		}
		jsonObject["rhythm"]["randomDelayMinMs"] = 600;
		jsonObject["rhythm"]["randomDelayMaxMs"] = 1800;
		jsonObject["rhythm"]["betweenRunWaitMinSeconds"] = 5;
		jsonObject["rhythm"]["betweenRunWaitMaxSeconds"] = 15;
		jsonObject["rhythm"]["activationStart"] = "00:00";
		jsonObject["rhythm"]["activationEnd"] = "00:00";
		jsonObject["rhythm"]["activationDays"] = new JsonArray(Enumerable.Range(1, 7).Select((Func<int, JsonNode>)((int day) => JsonValue.Create(day))).ToArray());
		jsonObject["fusion"]["fontSize"] = 11;
		jsonObject["fusion"]["rowsPerCard"] = 3;
		jsonObject["fusion"]["cycleSeconds"] = 5;
		jsonObject["fusion"]["offsetX"] = 0;
		jsonObject["fusion"]["gap"] = 8;
		jsonObject["fusion"]["showLevels"] = true;
		jsonObject["fusion"]["showLocks"] = true;
		jsonObject["quantity"]["fontSize"] = 13;
		jsonObject["quantity"]["showLimit"] = true;
		jsonObject["alerts"]["tone"] = "chime";
		jsonObject["alerts"]["volume"] = 50;
		jsonObject["alerts"]["cooldownSeconds"] = 15;
		jsonObject["alerts"]["lowHealthPercent"] = 25;
		jsonObject["alerts"]["events"] = new JsonObject(AlertEvents.Select(delegate(string key)
		{
			if (!(key == "boss"))
			{
				switch (key)
				{
				case "rare":
				case "downed":
				case "revive":
				case "matchEnd":
				case "saveFailure":
					break;
				default:
					goto IL_0054;
				}
			}
			bool value = true;
			goto IL_0056;
			IL_0056:
			return KeyValuePair.Create(key, (JsonNode)JsonValue.Create(value));
			IL_0054:
			value = false;
			goto IL_0056;
		}));
		jsonObject["recommendations"]["source"] = "recommended";
		jsonObject["recommendations"]["fontSize"] = 13;
		jsonObject["recommendations"]["opacity"] = 90;
		jsonObject["recommendations"]["color"] = "#23795c";
		foreach (string item in from key in BooleanKeys("recommendations")
			where key != "enabled"
			select key)
		{
			jsonObject["recommendations"][item] = true;
		}
		return jsonObject;
	}

	private static bool Number(JsonNode? node, out double number)
	{
		number = 0.0;
		if (node is JsonValue jsonValue && jsonValue.GetValueKind() == JsonValueKind.Number && (jsonValue.TryGetValue<double>(out number) || double.TryParse(jsonValue.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out number)))
		{
			return double.IsFinite(number);
		}
		return false;
	}

	private static string? Text(JsonNode? node)
	{
		if (!(node is JsonValue jsonValue) || !jsonValue.TryGetValue<string>(out string value))
		{
			return null;
		}
		return value;
	}

	private static bool Color(JsonNode? node)
	{
		string text = Text(node);
		if (text != null)
		{
			return Regex.IsMatch(text, "^#[a-fA-F0-9]{6}$", RegexOptions.CultureInvariant);
		}
		return false;
	}

	internal static JsonObject Normalize(JsonNode? value, JsonNode? legacyFlat = null)
	{
		JsonObject jsonObject = ((value is JsonObject jsonObject2) ? jsonObject2.DeepClone().AsObject() : new JsonObject());
		string[] array;
		if (!(jsonObject["rhythm"] is JsonObject))
		{
			JsonObject jsonObject3 = jsonObject["detection"] as JsonObject;
			jsonObject["rhythm"] = jsonObject3?.DeepClone() ?? new JsonObject();
			if (jsonObject3 == null && legacyFlat is JsonObject jsonObject4)
			{
				array = new string[6] { "randomDelay", "randomDelayMinMs", "randomDelayMaxMs", "betweenRunWait", "betweenRunWaitMinSeconds", "betweenRunWaitMaxSeconds" };
				foreach (string propertyName in array)
				{
					if (jsonObject4.ContainsKey(propertyName))
					{
						jsonObject["rhythm"][propertyName] = jsonObject4[propertyName]?.DeepClone();
					}
				}
			}
		}
		jsonObject.Remove("detection");
		JsonObject jsonObject5 = Defaults();
		array = Groups;
		foreach (string text in array)
		{
			if (!(jsonObject[text] is JsonObject))
			{
				jsonObject[text] = jsonObject5[text]?.DeepClone();
			}
			JsonObject jsonObject6 = jsonObject[text].AsObject();
			foreach (string item in BooleanKeys(text))
			{
				if (!Boolean(jsonObject6[item]))
				{
					jsonObject6[item] = jsonObject5[text][item]?.DeepClone();
				}
			}
		}
		(string, string, int, int)[] numbers = Numbers;
		for (int i = 0; i < numbers.Length; i++)
		{
			var (propertyName2, propertyName3, num, num2) = numbers[i];
			jsonObject[propertyName2][propertyName3] = (Number(jsonObject[propertyName2][propertyName3], out var number) ? JsonValue.Create((int)Math.Clamp(Math.Floor(number + 0.5), num, num2)) : jsonObject5[propertyName2][propertyName3]?.DeepClone());
		}
		if (!Tones.Contains<string>(Text(jsonObject["alerts"]["tone"])))
		{
			jsonObject["alerts"]["tone"] = "chime";
		}
		string text2 = Text(jsonObject["recommendations"]["source"]);
		if ((!(text2 == "recommended") && !(text2 == "currentPlan")) || 1 == 0)
		{
			jsonObject["recommendations"]["source"] = "recommended";
		}
		jsonObject["recommendations"]["color"] = (Color(jsonObject["recommendations"]["color"]) ? Text(jsonObject["recommendations"]["color"]).ToLowerInvariant() : "#23795c");
		if (!(jsonObject["alerts"]["events"] is JsonObject))
		{
			jsonObject["alerts"]["events"] = jsonObject5["alerts"]["events"]?.DeepClone();
		}
		array = AlertEvents;
		foreach (string propertyName4 in array)
		{
			if (!Boolean(jsonObject["alerts"]["events"][propertyName4]))
			{
				jsonObject["alerts"]["events"][propertyName4] = jsonObject5["alerts"]["events"][propertyName4]?.DeepClone();
			}
		}
		JsonObject jsonObject7 = jsonObject["rhythm"].AsObject();
		(string, string)[] array2 = new(string, string)[2]
		{
			("randomDelayMinMs", "randomDelayMaxMs"),
			("betweenRunWaitMinSeconds", "betweenRunWaitMaxSeconds")
		};
		for (int i = 0; i < array2.Length; i++)
		{
			var (propertyName5, propertyName6) = array2[i];
			if (jsonObject7[propertyName5].GetValue<int>() > jsonObject7[propertyName6].GetValue<int>())
			{
				JsonNode value2 = jsonObject7[propertyName5].DeepClone();
				jsonObject7[propertyName5] = jsonObject7[propertyName6].DeepClone();
				jsonObject7[propertyName6] = value2;
			}
		}
		array = new string[2] { "activationStart", "activationEnd" };
		foreach (string propertyName7 in array)
		{
			if (!jsonObject7.ContainsKey(propertyName7))
			{
				jsonObject7[propertyName7] = jsonObject5["rhythm"][propertyName7].DeepClone();
			}
			else if (!Clock(jsonObject7[propertyName7]))
			{
				jsonObject7[propertyName7] = "";
			}
		}
		if (!jsonObject7.ContainsKey("activationDays"))
		{
			jsonObject7["activationDays"] = jsonObject5["rhythm"]["activationDays"].DeepClone();
		}
		else if (!Days(jsonObject7["activationDays"]))
		{
			jsonObject7["activationDays"] = new JsonArray();
		}
		else
		{
			jsonObject7["activationDays"] = new JsonArray(((IEnumerable<int>)(from day in jsonObject7["activationDays"].AsArray()
				select Number(day, out var number2) ? ((int)number2) : 0).Order()).Select((Func<int, JsonNode>)((int day) => JsonValue.Create(day))).ToArray());
		}
		return jsonObject;
	}

	private static bool Clock(JsonNode? value)
	{
		string text = Text(value);
		if (text != null)
		{
			return Regex.IsMatch(text, "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$", RegexOptions.CultureInvariant);
		}
		return false;
	}

	private static bool Days(JsonNode? value)
	{
		if (value is JsonArray { Count: var count } jsonArray && count >= 1 && count <= 7 && jsonArray.All((JsonNode day) => Number(day, out var number) && number >= 1.0 && number <= 7.0 && number == Math.Truncate(number)))
		{
			return jsonArray.Select((JsonNode day) => (!Number(day, out var number)) ? double.NaN : number).Distinct().Count() == jsonArray.Count;
		}
		return false;
	}

	internal static void ValidatePatch(JsonNode? value)
	{
		if (!(value is JsonObject jsonObject))
		{
			throw new InvalidOperationException("便利功能设置必须是对象。");
		}
		string[] array;
		if (jsonObject["rhythm"] is JsonObject jsonObject2)
		{
			array = new string[2] { "activationStart", "activationEnd" };
			foreach (string propertyName in array)
			{
				if (jsonObject2.ContainsKey(propertyName) && !Clock(jsonObject2[propertyName]))
				{
					throw new InvalidOperationException("脚本启用时间须为北京时间 HH:mm。");
				}
			}
			if (jsonObject2.ContainsKey("activationDays") && !Days(jsonObject2["activationDays"]))
			{
				throw new InvalidOperationException("至少选择一个有效星期，且不能重复。");
			}
		}
		array = Groups;
		foreach (string text in array)
		{
			if (!jsonObject.ContainsKey(text))
			{
				continue;
			}
			if (!(jsonObject[text] is JsonObject jsonObject3))
			{
				throw new InvalidOperationException("便利功能设置分组格式无效：" + text);
			}
			foreach (string item in BooleanKeys(text))
			{
				if (jsonObject3.ContainsKey(item) && !Boolean(jsonObject3[item]))
				{
					throw new InvalidOperationException("便利功能开关格式无效：" + text + "." + item);
				}
			}
		}
		(string, string, int, int)[] numbers = Numbers;
		for (int i = 0; i < numbers.Length; i++)
		{
			var (text2, text3, num, num2) = numbers[i];
			if (jsonObject[text2] is JsonObject jsonObject4 && jsonObject4.ContainsKey(text3) && (!Number(jsonObject4[text3], out var number) || number < (double)num || number > (double)num2 || number != Math.Truncate(number)))
			{
				throw new InvalidOperationException("便利功能数值超出范围或不是整数：" + text2 + "." + text3);
			}
		}
		if (jsonObject["alerts"] is JsonObject jsonObject5)
		{
			if (jsonObject5.ContainsKey("tone") && !Tones.Contains<string>(Text(jsonObject5["tone"])))
			{
				throw new InvalidOperationException("提醒音类型无效。");
			}
			if (jsonObject5.ContainsKey("events"))
			{
				if (!(jsonObject5["events"] is JsonObject jsonObject6))
				{
					throw new InvalidOperationException("提醒事件设置必须是对象。");
				}
				array = AlertEvents;
				foreach (string text4 in array)
				{
					if (jsonObject6.ContainsKey(text4) && !Boolean(jsonObject6[text4]))
					{
						throw new InvalidOperationException("提醒事件开关格式无效：" + text4);
					}
				}
			}
		}
		if (jsonObject["recommendations"] is JsonObject jsonObject7)
		{
			bool flag = jsonObject7.ContainsKey("source");
			if (flag)
			{
				string text5 = Text(jsonObject7["source"]);
				bool flag2 = ((text5 == "recommended" || text5 == "currentPlan") ? true : false);
				flag = !flag2;
			}
			if (flag)
			{
				throw new InvalidOperationException("推荐来源无效。");
			}
			if (jsonObject7.ContainsKey("color") && !Color(jsonObject7["color"]))
			{
				throw new InvalidOperationException("推荐颜色须为 #RRGGBB。");
			}
		}
	}

	internal static JsonObject Merge(JsonNode? current, JsonObject patch)
	{
		ValidatePatch(patch);
		JsonObject jsonObject = Normalize(current);
		foreach (KeyValuePair<string, JsonNode> item in patch)
		{
			if (!Groups.Contains(item.Key))
			{
				jsonObject[item.Key] = item.Value?.DeepClone();
				continue;
			}
			foreach (KeyValuePair<string, JsonNode> item2 in item.Value.AsObject())
			{
				if (item.Key == "alerts" && item2.Key == "events")
				{
					foreach (KeyValuePair<string, JsonNode> item3 in item2.Value.AsObject())
					{
						jsonObject["alerts"]["events"][item3.Key] = item3.Value?.DeepClone();
					}
				}
				else
				{
					jsonObject[item.Key][item2.Key] = item2.Value?.DeepClone();
				}
			}
		}
		return Normalize(jsonObject);
	}
}
