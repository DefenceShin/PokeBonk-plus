using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace PokeBonk.Client;

internal static class OverlaySettings
{
	internal static readonly string[] Fields = new string[28]
	{
		"totalDamage", "moveDamage", "otherDamage", "revives", "averageDps", "damageShare", "elapsed", "kills", "damageTaken", "health",
		"shield", "experience", "gold", "ultimate", "armor", "critChance", "critDamage", "physical", "special", "damageMultiplier",
		"attackSpeed", "moveSpeed", "luck", "xpGain", "healingMultiplier", "regen", "itemTriggers", "rebirth"
	};

	internal static readonly string[] TeamFields = new string[21]
	{
		"identity", "totalDamage", "averageDps", "recentDps", "damageShare", "moveDamage", "otherDamage", "kills", "health", "shield",
		"level", "revives", "status", "damageTaken", "items", "vitamins", "ultimate", "rescue", "area", "distance",
		"connection"
	};

	private static readonly string[] TeamBooleans = new string[4] { "enabled", "shareStats", "includeSelf", "sameAreaOnly" };

	private static readonly string[] TeamSorts = new string[3] { "damage", "slot", "name" };

	private static readonly (string Key, int Default)[] TeamNumbers = new(string, int)[2]
	{
		("recentSeconds", 10),
		("staleSeconds", 8)
	};

	private static readonly string[] Booleans = new string[4] { "enabled", "compactNumbers", "hidePaused", "autoPage" };

	private static readonly (string Key, double Minimum, double Maximum, double Step)[] Numbers = new(string, double, double, double)[10]
	{
		("fontSize", 10.0, 26.0, 1.0),
		("width", 160.0, 560.0, 1.0),
		("height", 120.0, 800.0, 1.0),
		("x", 0.0, 100.0, 0.0),
		("y", 0.0, 100.0, 0.0),
		("rowGap", 0.0, 12.0, 1.0),
		("refreshMs", 250.0, 2000.0, 250.0),
		("opacity", 0.0, 95.0, 1.0),
		("pageSeconds", 3.0, 20.0, 1.0),
		("page", 1.0, 9999.0, 1.0)
	};

	internal static JsonObject Defaults()
	{
		return new JsonObject
		{
			["enabled"] = true,
			["fields"] = new JsonObject(Fields.Select((string field, int index) => KeyValuePair.Create(field, (JsonNode)JsonValue.Create(index < 4)))),
			["compactNumbers"] = true,
			["fontSize"] = 12,
			["fontColor"] = "#ffffff",
			["backgroundColor"] = "#10251e",
			["opacity"] = 45,
			["width"] = 220,
			["height"] = 260,
			["x"] = 1.5,
			["y"] = 46,
			["rowGap"] = 4,
			["refreshMs"] = 500,
			["hidePaused"] = true,
			["autoPage"] = true,
			["pageSeconds"] = 6,
			["page"] = 1,
			["team"] = TeamDefaults()
		};
	}

	internal static JsonObject TeamDefaults()
	{
		return new JsonObject
		{
			["enabled"] = false,
			["shareStats"] = false,
			["includeSelf"] = false,
			["sameAreaOnly"] = false,
			["sort"] = "damage",
			["recentSeconds"] = 10,
			["staleSeconds"] = 8,
			["fields"] = new JsonObject(TeamFields.Select((string field) => KeyValuePair.Create(field, (JsonNode)JsonValue.Create(value: false))))
		};
	}

	private static bool Number(JsonNode? node, out double number)
	{
		number = 0.0;
		if (!(node is JsonValue jsonValue) || jsonValue.GetValueKind() != JsonValueKind.Number)
		{
			return false;
		}
		if (!jsonValue.TryGetValue<double>(out number) && !double.TryParse(jsonValue.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out number))
		{
			return false;
		}
		return double.IsFinite(number);
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

	private static bool Color(JsonNode? node, out string color)
	{
		color = "";
		if (node is JsonValue jsonValue && jsonValue.TryGetValue<string>(out color))
		{
			return Regex.IsMatch(color, "^#[0-9a-fA-F]{6}$", RegexOptions.CultureInvariant);
		}
		return false;
	}

	internal static JsonObject Normalize(JsonNode? value)
	{
		JsonObject jsonObject = Defaults();
		JsonObject jsonObject2 = ((value is JsonObject jsonObject3) ? jsonObject3.DeepClone().AsObject() : new JsonObject());
		string[] booleans = Booleans;
		foreach (string propertyName in booleans)
		{
			if (!Boolean(jsonObject2[propertyName]))
			{
				jsonObject2[propertyName] = jsonObject[propertyName]?.DeepClone();
			}
		}
		(string, double, double, double)[] numbers = Numbers;
		for (int i = 0; i < numbers.Length; i++)
		{
			var (propertyName2, min, max, num) = numbers[i];
			if (!Number(jsonObject2[propertyName2], out var number))
			{
				jsonObject2[propertyName2] = jsonObject[propertyName2]?.DeepClone();
				continue;
			}
			number = Math.Clamp(number, min, max);
			if (num > 0.0)
			{
				number = Math.Clamp(Math.Round(number / num, MidpointRounding.AwayFromZero) * num, min, max);
			}
			jsonObject2[propertyName2] = ((num > 0.0) ? JsonValue.Create((int)number) : JsonValue.Create(number));
		}
		booleans = new string[2] { "fontColor", "backgroundColor" };
		foreach (string propertyName3 in booleans)
		{
			jsonObject2[propertyName3] = (Color(jsonObject2[propertyName3], out string color) ? JsonValue.Create(color.ToLowerInvariant()) : jsonObject[propertyName3]?.DeepClone());
		}
		JsonObject jsonObject4 = (jsonObject2["fields"] as JsonObject) ?? new JsonObject();
		booleans = Fields;
		foreach (string propertyName4 in booleans)
		{
			if (!Boolean(jsonObject4[propertyName4]))
			{
				jsonObject4[propertyName4] = jsonObject["fields"][propertyName4]?.DeepClone();
			}
		}
		if (!(jsonObject2["fields"] is JsonObject))
		{
			jsonObject2["fields"] = jsonObject4;
		}
		JsonObject jsonObject5 = (jsonObject2["team"] as JsonObject) ?? new JsonObject();
		booleans = TeamBooleans;
		foreach (string propertyName5 in booleans)
		{
			if (!Boolean(jsonObject5[propertyName5]))
			{
				jsonObject5[propertyName5] = false;
			}
		}
		if (!(jsonObject5["sort"] is JsonValue jsonValue) || !jsonValue.TryGetValue<string>(out string value2) || !TeamSorts.Contains(value2))
		{
			jsonObject5["sort"] = "damage";
		}
		(string, int)[] teamNumbers = TeamNumbers;
		for (int i = 0; i < teamNumbers.Length; i++)
		{
			(string, int) tuple2 = teamNumbers[i];
			string item = tuple2.Item1;
			int item2 = tuple2.Item2;
			jsonObject5[item] = (Number(jsonObject5[item], out var number2) ? ((int)Math.Clamp(Math.Round(number2, MidpointRounding.AwayFromZero), 3.0, 30.0)) : item2);
		}
		JsonObject jsonObject6 = (jsonObject5["fields"] as JsonObject) ?? new JsonObject();
		booleans = TeamFields;
		foreach (string propertyName6 in booleans)
		{
			if (!Boolean(jsonObject6[propertyName6]))
			{
				jsonObject6[propertyName6] = false;
			}
		}
		if (!(jsonObject5["fields"] is JsonObject))
		{
			jsonObject5["fields"] = jsonObject6;
		}
		if (!(jsonObject2["team"] is JsonObject))
		{
			jsonObject2["team"] = jsonObject5;
		}
		return jsonObject2;
	}

	internal static void ValidatePatch(JsonNode? value)
	{
		if (!(value is JsonObject jsonObject))
		{
			throw new InvalidOperationException("战斗数据显示设置必须是对象。");
		}
		string[] booleans = Booleans;
		foreach (string text in booleans)
		{
			if (jsonObject.ContainsKey(text) && !Boolean(jsonObject[text]))
			{
				throw new InvalidOperationException("战斗数据显示开关格式无效：" + text);
			}
		}
		(string, double, double, double)[] numbers = Numbers;
		for (int i = 0; i < numbers.Length; i++)
		{
			var (text2, num, num2, num3) = numbers[i];
			if (jsonObject.ContainsKey(text2) && (!Number(jsonObject[text2], out var number) || number < num || number > num2 || (num3 > 0.0 && number % num3 != 0.0)))
			{
				throw new InvalidOperationException("战斗数据显示数值超出范围或步长无效：" + text2);
			}
		}
		booleans = new string[2] { "fontColor", "backgroundColor" };
		foreach (string text3 in booleans)
		{
			if (jsonObject.ContainsKey(text3) && !Color(jsonObject[text3], out string _))
			{
				throw new InvalidOperationException("战斗数据显示颜色须为 #RRGGBB：" + text3);
			}
		}
		if (jsonObject.ContainsKey("fields"))
		{
			if (!(jsonObject["fields"] is JsonObject jsonObject2))
			{
				throw new InvalidOperationException("战斗数据显示字段必须是对象。");
			}
			booleans = Fields;
			foreach (string text4 in booleans)
			{
				if (jsonObject2.ContainsKey(text4) && !Boolean(jsonObject2[text4]))
				{
					throw new InvalidOperationException("战斗数据显示字段开关格式无效：" + text4);
				}
			}
		}
		if (!jsonObject.ContainsKey("team"))
		{
			return;
		}
		if (!(jsonObject["team"] is JsonObject jsonObject3))
		{
			throw new InvalidOperationException("队友数据显示设置必须是对象。");
		}
		booleans = TeamBooleans;
		foreach (string text5 in booleans)
		{
			if (jsonObject3.ContainsKey(text5) && !Boolean(jsonObject3[text5]))
			{
				throw new InvalidOperationException("队友数据显示开关格式无效：" + text5);
			}
		}
		if (jsonObject3.ContainsKey("sort") && (!(jsonObject3["sort"] is JsonValue jsonValue) || !jsonValue.TryGetValue<string>(out string value2) || !TeamSorts.Contains(value2)))
		{
			throw new InvalidOperationException("队友数据显示排序方式无效。");
		}
		(string, int)[] teamNumbers = TeamNumbers;
		for (int i = 0; i < teamNumbers.Length; i++)
		{
			string item = teamNumbers[i].Item1;
			if (jsonObject3.ContainsKey(item) && (!Number(jsonObject3[item], out var number2) || number2 < 3.0 || number2 > 30.0 || number2 % 1.0 != 0.0))
			{
				throw new InvalidOperationException("队友数据显示时间须为 3 至 30 的整数秒：" + item);
			}
		}
		if (!jsonObject3.ContainsKey("fields"))
		{
			return;
		}
		if (!(jsonObject3["fields"] is JsonObject jsonObject4))
		{
			throw new InvalidOperationException("队友数据显示字段必须是对象。");
		}
		booleans = TeamFields;
		foreach (string text6 in booleans)
		{
			if (jsonObject4.ContainsKey(text6) && !Boolean(jsonObject4[text6]))
			{
				throw new InvalidOperationException("队友数据显示字段开关格式无效：" + text6);
			}
		}
	}

	internal static JsonObject Merge(JsonNode? current, JsonObject patch)
	{
		ValidatePatch(patch);
		JsonObject jsonObject = Normalize(current);
		foreach (KeyValuePair<string, JsonNode> item in patch)
		{
			if (item.Key == "fields")
			{
				foreach (KeyValuePair<string, JsonNode> item2 in item.Value.AsObject())
				{
					jsonObject["fields"][item2.Key] = item2.Value?.DeepClone();
				}
			}
			else if (item.Key == "team")
			{
				foreach (KeyValuePair<string, JsonNode> item3 in item.Value.AsObject())
				{
					if (item3.Key == "fields")
					{
						foreach (KeyValuePair<string, JsonNode> item4 in item3.Value.AsObject())
						{
							jsonObject["team"]["fields"][item4.Key] = item4.Value?.DeepClone();
						}
					}
					else
					{
						jsonObject["team"][item3.Key] = item3.Value?.DeepClone();
					}
				}
			}
			else
			{
				jsonObject[item.Key] = item.Value?.DeepClone();
			}
		}
		return Normalize(jsonObject);
	}
}
