using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace PokeBonk.Client;

internal static class ClientLogRetention
{
	internal const int DefaultRuns = 100;

	internal const int UngroupedLimit = 256;

	internal static readonly int[] Choices = new int[8] { 1, 5, 10, 20, 50, 100, 1000, 0 };

	internal static int Normalize(JsonNode? value)
	{
		if (!(value is JsonValue jsonValue) || !jsonValue.TryGetValue<int>(out var value2) || !Choices.Contains(value2))
		{
			return 100;
		}
		return value2;
	}

	internal static string Group(string? accountScope, string marker)
	{
		return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("pb-local-journal:" + accountScope + ":" + marker))).ToLowerInvariant().Substring(0, 32);
	}

	internal static string? StartedAt(string? marker)
	{
		if (!long.TryParse(marker?.Trim('"'), NumberStyles.Integer, CultureInfo.InvariantCulture, out var result))
		{
			return null;
		}
		try
		{
			return DateTimeOffset.FromUnixTimeMilliseconds(result).ToString("O");
		}
		catch (ArgumentOutOfRangeException)
		{
			return null;
		}
	}

	private static string? Text(JsonNode? node)
	{
		if (!(node is JsonValue jsonValue) || !jsonValue.TryGetValue<string>(out string value))
		{
			return null;
		}
		return value;
	}

	private static bool Flag(JsonNode? node)
	{
		bool value = default(bool);
		return node is JsonValue jsonValue && jsonValue.TryGetValue<bool>(out value) && value;
	}

	internal static bool IsEnd(JsonObject row)
	{
		if (!Flag(row["isRunResult"]) && !(Text(row["type"]) == "result"))
		{
			if (Text(row["type"]) == "error")
			{
				string text = Text(row["title"]);
				if (text != null && text.StartsWith("本局", StringComparison.Ordinal))
				{
					return text.Contains("保存", StringComparison.Ordinal);
				}
			}
			return false;
		}
		return true;
	}

	internal static IReadOnlyList<JsonObject> Select(IEnumerable<JsonObject> input, int runs, string? activeGroup = null)
	{
		runs = (Choices.Contains(runs) ? runs : 100);
		LinkedList<JsonObject> linkedList = new LinkedList<JsonObject>();
		Dictionary<string, List<LinkedListNode<JsonObject>>> dictionary = new Dictionary<string, List<LinkedListNode<JsonObject>>>(StringComparer.Ordinal);
		SortedSet<(long, string)> sortedSet = new SortedSet<(long, string)>();
		Queue<LinkedListNode<JsonObject>> queue = new Queue<LinkedListNode<JsonObject>>();
		string text = null;
		string text2 = null;
		long num = 0L;
		foreach (JsonObject item3 in input)
		{
			JsonObject jsonObject = item3.DeepClone().AsObject();
			string text3 = Text(jsonObject["runGroup"]);
			string text4 = Text(jsonObject["type"]);
			if (text3 == null && (text4 == "run" || (text == null && IsEnd(jsonObject))))
			{
				text2 = Text(jsonObject["at"]) ?? Text(jsonObject["time"]);
				string text5 = Text(jsonObject["id"]);
				if (text5 == null)
				{
					text5 = text2;
					if (text5 == null)
					{
						long num2 = ++num;
						text5 = num2.ToString(CultureInfo.InvariantCulture);
					}
				}
				text = "legacy-" + Group(null, text5);
			}
			if (text3 == null && jsonObject["journalSchema"] == null && text != null)
			{
				text3 = text;
				jsonObject["runGroup"] = text3;
				jsonObject["runStartedAt"] = text2;
			}
			jsonObject.Remove("runId");
			JsonObject jsonObject2 = jsonObject;
			if (jsonObject2["category"] == null)
			{
				JsonNode jsonNode = (jsonObject2["category"] = ClientLogPolicy.Category(text4 ?? "info", Text(jsonObject["title"]) ?? Text(jsonObject["message"]) ?? ""));
			}
			if (IsEnd(jsonObject))
			{
				jsonObject["isRunResult"] = true;
			}
			LinkedListNode<JsonObject> item = linkedList.AddLast(jsonObject);
			if (text3 == null)
			{
				queue.Enqueue(item);
				if (runs > 0 && queue.Count > 256)
				{
					linkedList.Remove(queue.Dequeue());
				}
				continue;
			}
			if (!dictionary.TryGetValue(text3, out var value))
			{
				value = (dictionary[text3] = new List<LinkedListNode<JsonObject>>());
				DateTimeOffset result;
				long item2 = (DateTimeOffset.TryParse(Text(jsonObject["runStartedAt"]) ?? Text(jsonObject["at"]) ?? Text(jsonObject["time"]), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out result) ? result.UtcTicks : num++);
				if (text3 != activeGroup)
				{
					sortedSet.Add((item2, text3));
				}
			}
			value.Add(item);
			if (runs == 0)
			{
				continue;
			}
			while (sortedSet.Count > runs)
			{
				(long, string) min = sortedSet.Min;
				sortedSet.Remove(min);
				foreach (LinkedListNode<JsonObject> item4 in dictionary[min.Item2])
				{
					linkedList.Remove(item4);
				}
				dictionary.Remove(min.Item2);
			}
		}
		return linkedList.ToArray();
	}
}
