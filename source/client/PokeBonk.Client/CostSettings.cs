using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace PokeBonk.Client;

internal static class CostSettings
{
	private static readonly JsonArray Effects = ReadCatalog();

	private static readonly HashSet<string> Allowed = (from entry in Effects.OfType<JsonObject>().Where(delegate(JsonObject entry)
		{
			JsonNode? jsonNode = entry["id"];
			return jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.String;
		})
		select entry["id"].GetValue<string>()).ToHashSet<string>(StringComparer.Ordinal);

	private static JsonArray ReadCatalog()
	{
		using Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.cost-effects.json");
		if (stream == null)
		{
			return new JsonArray();
		}
		try
		{
			return (JsonNode.Parse(stream) is JsonArray jsonArray && jsonArray.All(delegate(JsonNode entry)
			{
				if (entry is JsonObject jsonObject)
				{
					JsonNode? jsonNode = jsonObject["id"];
					if (jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.String)
					{
						JsonNode? jsonNode2 = jsonObject["label"];
						if (jsonNode2 == null)
						{
							return false;
						}
						return jsonNode2.GetValueKind() == JsonValueKind.String;
					}
				}
				return false;
			})) ? jsonArray : new JsonArray();
		}
		catch (JsonException)
		{
			return new JsonArray();
		}
	}

	internal static JsonArray Catalog()
	{
		return Effects.DeepClone().AsArray();
	}

	internal static JsonArray EmptyPriorities()
	{
		return new JsonArray(((IEnumerable<JsonNode>)(from _ in Enumerable.Range(0, 10)
			select JsonValue.Create(""))).ToArray());
	}

	internal static JsonArray Priorities(JsonNode? raw)
	{
		JsonArray jsonArray = EmptyPriorities();
		if (!(raw is JsonArray jsonArray2))
		{
			return jsonArray;
		}
		for (int i = 0; i < Math.Min(10, jsonArray2.Count); i++)
		{
			JsonNode jsonNode = jsonArray2[i];
			if (jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.String)
			{
				string value = jsonNode.GetValue<string>();
				if (Allowed.Contains(value) || (Allowed.Count == 0 && Regex.IsMatch(value, "^[A-Za-z][A-Za-z0-9]{0,63}$", RegexOptions.CultureInvariant)))
				{
					jsonArray[i] = value;
				}
			}
		}
		return jsonArray;
	}

	internal static void Normalize(JsonObject value)
	{
		JsonNode? jsonNode = value["forceCostInteractions"];
		value["forceCostInteractions"] = jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.True;
		value["costEffectPriorities"] = Priorities(value["costEffectPriorities"]);
	}
}
