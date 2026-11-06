using System;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace PokeBonk.Client;

internal sealed class ClientAccountObservation
{
	private string? identity;

	internal string? IdentityHash => identity;

	internal bool HasIdentity { get; private set; }

	internal static string HashIdentity(string type, string id)
	{
		return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("pokebonk-client-account:" + type + ":" + id))).ToLowerInvariant();
	}

	private static string? Text(JsonNode? node)
	{
		if (!(node is JsonValue jsonValue) || !jsonValue.TryGetValue<string>(out string value))
		{
			return null;
		}
		return value;
	}

	internal bool Observe(JsonObject? snapshot, ClientObservationIds runs, ClientObservationIds results, ClientObservationIds events)
	{
		string text = Text(snapshot?["accountType"]);
		string value;
		double value2;
		string text2 = ((snapshot?["accountId"] is JsonValue jsonValue && jsonValue.TryGetValue<string>(out value)) ? value : ((snapshot?["accountId"] is JsonValue jsonValue2 && jsonValue2.TryGetValue<double>(out value2) && double.IsFinite(value2)) ? value2.ToString("R", CultureInfo.InvariantCulture) : null));
		bool flag = ((text == "guest" || text == "registered") ? true : false);
		HasIdentity = flag && !string.IsNullOrEmpty(text2);
		if (!HasIdentity)
		{
			return false;
		}
		string text3 = HashIdentity(text, text2);
		bool num = identity != null && identity != text3;
		identity = text3;
		if (!num)
		{
			return false;
		}
		foreach (JsonObject item in ((snapshot?["events"] as JsonArray) ?? new JsonArray()).OfType<JsonObject>())
		{
			string id = Text(item?["id"]) ?? "";
			if (Text(item?["kind"]) == "settlement")
			{
				results.Add(Text(item?["id"]) ?? item?["runAt"]?.ToJsonString() ?? "");
			}
			else
			{
				events.Add(id);
			}
		}
		foreach (JsonObject item2 in ((snapshot?["history"] as JsonArray) ?? new JsonArray()).OfType<JsonObject>())
		{
			if (Text(item2?["event"]) == "run")
			{
				runs.Add(item2?["at"]?.ToJsonString() ?? "");
			}
		}
		return true;
	}
}
