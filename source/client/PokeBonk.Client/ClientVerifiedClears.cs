using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace PokeBonk.Client;

internal sealed class ClientVerifiedClears
{
	internal const int Capacity = 4096;

	internal const int MaximumBytes = 524288;

	private readonly PortableStorage storage;

	private readonly string identity;

	private readonly string path;

	private readonly HashSet<int> species;

	private readonly HashSet<string> maps;

	private readonly HashSet<VerifiedClear> cells = new HashSet<VerifiedClear>();

	private readonly SemaphoreSlim writeLock = new SemaphoreSlim(1, 1);

	private bool loaded;

	private long revision;

	private long savedRevision;

	internal string? ReadWarning { get; private set; }

	internal long Revision => revision;

	internal int Count => cells.Count;

	internal bool Dirty => revision != savedRevision;

	internal ClientVerifiedClears(PortableStorage storage, string identity, IEnumerable<int> species, IEnumerable<string> maps)
	{
		if (!Regex.IsMatch(identity, "^[a-f0-9]{64}$", RegexOptions.CultureInvariant))
		{
			throw new ArgumentException("无效的本地进度分区。");
		}
		this.storage = storage;
		this.identity = identity;
		this.species = species.Where((int id) => id >= 1 && id <= 100000).Take(1000).ToHashSet();
		this.maps = maps.Where((string id) => Regex.IsMatch(id, "^[a-z][a-z0-9_-]{0,47}$", RegexOptions.CultureInvariant)).Take(32).ToHashSet<string>(StringComparer.Ordinal);
		path = storage.DataPath("verified-clears-" + identity + ".json");
	}

	private static string? Text(JsonNode? node)
	{
		if (!(node is JsonValue jsonValue) || !jsonValue.TryGetValue<string>(out string value))
		{
			return null;
		}
		return value;
	}

	private static bool True(JsonNode? node)
	{
		bool value = default(bool);
		return node is JsonValue jsonValue && jsonValue.TryGetValue<bool>(out value) && value;
	}

	private VerifiedClear? Cell(JsonObject row)
	{
		int value = default(int);
		int value2 = default(int);
		bool flag = !(row["species"] is JsonValue jsonValue) || !jsonValue.TryGetValue<int>(out value) || !species.Contains(value) || !(row["tier"] is JsonValue jsonValue2) || !jsonValue2.TryGetValue<int>(out value2);
		if (!flag)
		{
			bool flag2 = ((value2 < 0 || value2 > 2) ? true : false);
			flag = flag2;
		}
		if (!flag)
		{
			string text = Text(row["biome"]);
			if (text != null && maps.Contains(text))
			{
				return new VerifiedClear(value, text, value2);
			}
		}
		return null;
	}

	internal void Load()
	{
		if (loaded)
		{
			return;
		}
		if (!File.Exists(storage.ValidatePath(path)))
		{
			loaded = true;
			return;
		}
		try
		{
			if (new FileInfo(storage.ValidatePath(path)).Length > 524288)
			{
				throw new JsonException();
			}
			if (!(JsonNode.Parse(File.ReadAllText(storage.ValidatePath(path))) is JsonObject jsonObject) || jsonObject["schemaVersion"]?.GetValue<int>() != 1 || Text(jsonObject["accountHash"]) != identity || !(jsonObject["clears"] is JsonArray { Count: <=4096 } jsonArray))
			{
				throw new JsonException();
			}
			foreach (JsonNode item in jsonArray)
			{
				if (item is JsonObject row)
				{
					VerifiedClear verifiedClear = Cell(row);
					if ((object)verifiedClear != null)
					{
						cells.Add(verifiedClear);
						continue;
					}
				}
				throw new JsonException();
			}
			loaded = true;
		}
		catch (Exception ex) when (((ex is JsonException || ex is InvalidOperationException || ex is FormatException) ? 1 : 0) != 0)
		{
			loaded = true;
			cells.Clear();
			ReadWarning = "本地通关格文件含无效或当前版本无法确认的记录，原文件已保留；本次仅使用新确认的内存进度。";
		}
	}

	private bool Add(JsonObject row)
	{
		Load();
		if (cells.Count < 4096)
		{
			VerifiedClear verifiedClear = Cell(row);
			if ((object)verifiedClear != null && cells.Add(verifiedClear))
			{
				revision++;
				return true;
			}
		}
		return false;
	}

	internal bool ObserveReceipt(JsonObject row)
	{
		if (Text(row["kind"]) != "settlement" || !True(row["saved"]) || !True(row["victory"]) || Text(row["nativeMode"]) != "standard" || Text(row["endHow"]) != "won" || !ClientProgressChanges.SettlementOutcome(row).NormalClear)
		{
			return false;
		}
		return Add(row);
	}

	internal bool ImportHistory(JsonArray rows)
	{
		bool flag = false;
		foreach (JsonObject item in rows.Take(2048).OfType<JsonObject>())
		{
			if (!item.ContainsKey("end") || item["end"] is JsonObject)
			{
				JsonObject obj = item["end"] as JsonObject;
				string text = Text(obj?["how"]);
				if ((obj == null || !obj.ContainsKey("how") || text != null) && !(Text(item["mode"]) != "standard") && True(item["victory"]) && (text == null || !(text != "won")))
				{
					flag |= Add(item);
				}
			}
		}
		return flag;
	}

	internal bool ImportScopedReceipts(JsonArray rows)
	{
		bool flag = false;
		foreach (JsonObject item in rows.Take(64).OfType<JsonObject>())
		{
			flag |= Add(item);
		}
		return flag;
	}

	internal JsonArray Snapshot()
	{
		Load();
		return new JsonArray(((IEnumerable<VerifiedClear>)cells.OrderBy((VerifiedClear cell) => cell.Species).ThenBy<VerifiedClear, string>((VerifiedClear cell) => cell.Biome, StringComparer.Ordinal).ThenBy((VerifiedClear cell) => cell.Tier)).Select((Func<VerifiedClear, JsonNode>)((VerifiedClear cell) => new JsonObject
		{
			["species"] = cell.Species,
			["biome"] = cell.Biome,
			["tier"] = cell.Tier
		})).ToArray());
	}

	internal async Task SaveAsync(Func<Task> requireCurrent)
	{
		if (!Dirty || ReadWarning != null)
		{
			return;
		}
		await writeLock.WaitAsync();
		string pending = null;
		try
		{
			if (Dirty && ReadWarning == null)
			{
				await requireCurrent();
				long capturedRevision = revision;
				string contents = new JsonObject
				{
					["schemaVersion"] = 1,
					["accountHash"] = identity,
					["clears"] = Snapshot()
				}.ToJsonString();
				pending = storage.ValidatePath(path + ".pending-" + Guid.NewGuid().ToString("N"));
				await File.WriteAllTextAsync(pending, contents);
				await requireCurrent();
				File.Move(storage.ValidatePath(pending), storage.ValidatePath(path), overwrite: true);
				pending = null;
				savedRevision = capturedRevision;
			}
		}
		finally
		{
			if (pending != null && File.Exists(storage.ValidatePath(pending)))
			{
				File.Delete(storage.ValidatePath(pending));
			}
			writeLock.Release();
		}
	}
}
