using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace PokeBonk.Client;

internal static class WecomSettings
{
	internal static string RegistryError = "";

	internal static readonly JsonObject Registry = LoadRegistry();

	internal static readonly IReadOnlyDictionary<string, JsonObject> Items = ((Registry["items"] as JsonArray) ?? new JsonArray()).OfType<JsonObject>().Where(delegate(JsonObject x)
	{
		JsonNode? jsonNode = x["id"];
		return jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.String;
	}).ToDictionary<JsonObject, string, JsonObject>((JsonObject x) => Text(x["id"]), (JsonObject x) => x, StringComparer.Ordinal);

	private static JsonObject LoadRegistry()
	{
		try
		{
			using Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.wecom-push-catalog.json");
			if (stream == null)
			{
				return Empty("企微项目目录缺失，仅此可选功能停用");
			}
			if (!(JsonNode.Parse(stream) is JsonObject jsonObject) || !(jsonObject["items"] is JsonArray { Count: <=4096 } jsonArray))
			{
				return Empty("企微项目目录格式无效，仅此可选功能停用");
			}
			HashSet<string> hashSet = new HashSet<string>(StringComparer.Ordinal);
			foreach (JsonNode item in jsonArray)
			{
				if (item is JsonObject jsonObject2)
				{
					JsonNode? jsonNode = jsonObject2["id"];
					if (jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.String && Regex.IsMatch(Text(jsonObject2["id"]), "^[A-Za-z0-9_.:-]{1,120}$") && hashSet.Add(Text(jsonObject2["id"])))
					{
						JsonNode? jsonNode2 = jsonObject2["label"];
						if (jsonNode2 != null && jsonNode2.GetValueKind() == JsonValueKind.String)
						{
							if (jsonObject2["fields"] is JsonArray jsonArray2 && jsonArray2.Select((JsonNode x) => (!(x is JsonObject jsonObject3)) ? Text(x) : Text(jsonObject3["id"])).Distinct().Count() != jsonArray2.Count)
							{
								return Empty("企微字段目录存在重复，仅此可选功能停用");
							}
							continue;
						}
					}
				}
				return Empty("企微项目目录含无效或重复项目，仅此可选功能停用");
			}
			return jsonObject;
		}
		catch
		{
			return Empty("企微项目目录无法读取，仅此可选功能停用");
		}
		static JsonObject Empty(string reason)
		{
			RegistryError = reason;
			return new JsonObject
			{
				["schemaVersion"] = 1,
				["items"] = new JsonArray(),
				["error"] = reason
			};
		}
	}

	internal static string Text(JsonNode? n, string fallback = "")
	{
		if (n == null || n.GetValueKind() != JsonValueKind.String)
		{
			return fallback;
		}
		return n.GetValue<string>();
	}

	internal static bool Yes(JsonNode? n)
	{
		if (n == null)
		{
			return false;
		}
		return n.GetValueKind() == JsonValueKind.True;
	}

	internal static bool Real(JsonNode? n, out double value)
	{
		value = 0.0;
		if (n != null && n.GetValueKind() == JsonValueKind.Number && double.TryParse(n.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out value))
		{
			return double.IsFinite(value);
		}
		return false;
	}

	internal static int Number(JsonNode? n, int fallback, int min, int max)
	{
		if (!Real(n, out var value))
		{
			return fallback;
		}
		return (int)Math.Clamp(Math.Truncate(value), min, max);
	}

	internal static string Short(JsonNode? n, int max = 80)
	{
		return new string((from c in Text(n)
			where !char.IsControl(c)
			select c).Take(max).ToArray());
	}

	internal static JsonObject Defaults()
	{
		return new JsonObject
		{
			["schemaVersion"] = 1,
			["enabled"] = false,
			["alias"] = "",
			["observeManual"] = false,
			["allowTeamDetails"] = false,
			["targetId"] = null,
			["items"] = new JsonObject(),
			["format"] = "text",
			["history"] = new JsonObject
			{
				["mode"] = "count",
				["count"] = 100,
				["days"] = 30,
				["maxMiB"] = 50
			},
			["network"] = new JsonObject
			{
				["timeoutSeconds"] = 10,
				["retries"] = 2,
				["proxy"] = "system"
			}
		};
	}

	internal static HashSet<string> Fields(JsonObject descriptor)
	{
		return (from n in ((descriptor["fields"] as JsonArray) ?? new JsonArray()).Where(delegate(JsonNode n)
			{
				if (n is JsonObject jsonObject)
				{
					JsonNode? jsonNode = jsonObject["availability"];
					if (jsonNode == null || jsonNode.GetValueKind() != JsonValueKind.False)
					{
						return Text(jsonObject["availability"]) != "unavailable";
					}
					return false;
				}
				return true;
			})
			select (!(n is JsonObject jsonObject)) ? Text(n) : Text(jsonObject["id"]) into x
			where x.Length > 0
			select x).ToHashSet<string>(StringComparer.Ordinal);
	}

	private static bool HasFields(JsonObject item, JsonObject descriptor)
	{
		HashSet<string> allowed = Fields(descriptor);
		if (item["fields"] is JsonArray source)
		{
			return source.Any((JsonNode x) => allowed.Contains(Text(x)));
		}
		return false;
	}

	internal static JsonObject Normalize(JsonNode? raw)
	{
		JsonObject jsonObject = (raw as JsonObject) ?? new JsonObject();
		JsonObject jsonObject2 = Defaults();
		string[] array = new string[3] { "enabled", "observeManual", "allowTeamDetails" };
		foreach (string propertyName in array)
		{
			jsonObject2[propertyName] = Yes(jsonObject[propertyName]);
		}
		jsonObject2["alias"] = Short(jsonObject["alias"], 48);
		jsonObject2["targetId"] = (ValidId(Text(jsonObject["targetId"])) ? Text(jsonObject["targetId"]) : null);
		JsonObject jsonObject3 = jsonObject["history"] as JsonObject;
		jsonObject2["history"] = new JsonObject
		{
			["mode"] = (new string[6] { "count", "days", "both", "permanent", "summary", "none" }.Contains(Text(jsonObject3?["mode"])) ? Text(jsonObject3?["mode"]) : "count"),
			["count"] = Number(jsonObject3?["count"], 100, 1, 100000),
			["days"] = Number(jsonObject3?["days"], 30, 1, 3650),
			["maxMiB"] = Number(jsonObject3?["maxMiB"], 50, 1, 1024)
		};
		JsonObject jsonObject4 = jsonObject["network"] as JsonObject;
		jsonObject2["network"] = new JsonObject
		{
			["timeoutSeconds"] = Number(jsonObject4?["timeoutSeconds"], 10, 3, 60),
			["retries"] = Number(jsonObject4?["retries"], 2, 0, 3),
			["proxy"] = ((Text(jsonObject4?["proxy"]) == "direct") ? "direct" : "system")
		};
		JsonObject jsonObject5 = jsonObject2["items"].AsObject();
		foreach (KeyValuePair<string, JsonNode> item in ((jsonObject["items"] as JsonObject) ?? new JsonObject()).Take(4096))
		{
			if (!Items.TryGetValue(item.Key, out JsonObject value) || !(item.Value is JsonObject jsonObject6))
			{
				continue;
			}
			HashSet<string> hashSet = Fields(value);
			JsonArray jsonArray = new JsonArray();
			foreach (string item2 in ((jsonObject6["fields"] as JsonArray) ?? new JsonArray()).Select((JsonNode x) => Text(x)).Distinct().Where(hashSet.Contains))
			{
				jsonArray.Add(JsonValue.Create(item2));
			}
			JsonArray jsonArray2 = new JsonArray();
			foreach (int item3 in (from x in (jsonObject6["days"] as JsonArray) ?? new JsonArray(new JsonNode[7] { 1, 2, 3, 4, 5, 6, 7 })
				select Number(x, 0, 0, 7) into x
				where x > 0
				select x).Distinct())
			{
				jsonArray2.Add(JsonValue.Create(item3));
			}
			JsonArray jsonArray3 = new JsonArray();
			foreach (string item4 in (from x in (jsonObject6["objectIds"] as JsonArray) ?? new JsonArray()
				select Short(x, 100) into x
				where x.Length > 0
				select x).Distinct().Take(256))
			{
				jsonArray3.Add(JsonValue.Create(item4));
			}
			string text = Text(jsonObject6["at"], "09:00");
			string[] source = (from x in (value["delivery"] as JsonArray) ?? new JsonArray("instant", "interval", "fixed", "both")
				select Text(x) into x
				where new string[4] { "instant", "interval", "fixed", "both" }.Contains(x)
				select x).ToArray();
			string key = item.Key;
			JsonObject jsonObject7 = new JsonObject
			{
				["enabled"] = Yes(jsonObject6["enabled"]),
				["delivery"] = (source.Contains(Text(jsonObject6["delivery"])) ? Text(jsonObject6["delivery"]) : (source.FirstOrDefault() ?? "interval")),
				["intervalMinutes"] = Number(jsonObject6["intervalMinutes"], 30, 1, 10080),
				["at"] = (Regex.IsMatch(text, "^([01][0-9]|2[0-3]):[0-5][0-9]$") ? text : "09:00"),
				["days"] = jsonArray2,
				["targetId"] = (ValidId(Text(jsonObject6["targetId"])) ? Text(jsonObject6["targetId"]) : null),
				["fields"] = jsonArray,
				["objectIds"] = jsonArray3,
				["filter"] = (new string[4] { "all", "new", "repeat", "unknown" }.Contains(Text(jsonObject6["filter"])) ? Text(jsonObject6["filter"]) : "all")
			};
			JsonObject jsonObject8 = jsonObject7;
			JsonNode? jsonNode = jsonObject6["includeUnknown"];
			jsonObject8["includeUnknown"] = jsonNode == null || jsonNode.GetValueKind() != JsonValueKind.False;
			jsonObject7["direction"] = (new string[3] { "any", "increase", "decrease" }.Contains(Text(jsonObject6["direction"])) ? Text(jsonObject6["direction"]) : "any");
			jsonObject7["minChange"] = (Real(jsonObject6["minChange"], out var value2) ? Math.Clamp(value2, 0.0, 1000000000.0) : 0.0);
			jsonObject5[key] = jsonObject7;
		}
		return jsonObject2;
	}

	internal static JsonObject Merge(JsonNode? current, JsonObject patch)
	{
		JsonObject jsonObject = Normalize(current);
		foreach (KeyValuePair<string, JsonNode> item in patch)
		{
			if (item.Key == "items" && item.Value is JsonObject jsonObject2)
			{
				foreach (KeyValuePair<string, JsonNode> item2 in jsonObject2)
				{
					if (!(item2.Value is JsonObject jsonObject3))
					{
						continue;
					}
					JsonObject jsonObject4 = (jsonObject["items"]?[item2.Key] as JsonObject) ?? new JsonObject();
					foreach (KeyValuePair<string, JsonNode> item3 in jsonObject3)
					{
						jsonObject4[item3.Key] = item3.Value?.DeepClone();
					}
					jsonObject["items"][item2.Key] = ((jsonObject4.Parent == null) ? jsonObject4 : jsonObject4.DeepClone());
				}
				continue;
			}
			string key = item.Key;
			bool flag = ((key == "history" || key == "network") ? true : false);
			if (flag && item.Value is JsonObject jsonObject5)
			{
				foreach (KeyValuePair<string, JsonNode> item4 in jsonObject5)
				{
					jsonObject[item.Key][item4.Key] = item4.Value?.DeepClone();
				}
			}
			else
			{
				jsonObject[item.Key] = item.Value?.DeepClone();
			}
		}
		return Normalize(jsonObject);
	}

	internal static bool ValidId(string s)
	{
		return Regex.IsMatch(s, "^[a-f0-9]{32}$", RegexOptions.CultureInvariant);
	}

	internal static IReadOnlyDictionary<string, JsonObject> Selected(JsonObject config)
	{
		return ((config["items"] as JsonObject) ?? new JsonObject()).Where<KeyValuePair<string, JsonNode>>((KeyValuePair<string, JsonNode> x) => x.Value is JsonObject jsonObject && Yes(jsonObject["enabled"]) && Items.ContainsKey(x.Key) && HasFields(jsonObject, Items[x.Key]) && Text(Items[x.Key]["availability"], "available") == "available" && Text(Items[x.Key]["source"]?["adapter"]) != "none" && ((Text(Items[x.Key]["privacy"]) != "team" && Text(Items[x.Key]["privacy"]) != "teammate") || Yes(config["allowTeamDetails"]))).ToDictionary<KeyValuePair<string, JsonNode>, string, JsonObject>((KeyValuePair<string, JsonNode> x) => x.Key, (KeyValuePair<string, JsonNode> x) => x.Value.AsObject(), StringComparer.Ordinal);
	}
}
