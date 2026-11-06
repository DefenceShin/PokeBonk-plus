using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PokeBonk.Client;

internal sealed class PlanFileStore(PortableStorage storage)
{
	public const int MaximumBytes = 8000000;

	public JsonArray Read(string selectedFile)
	{
		FileInfo fileInfo = new FileInfo(selectedFile);
		if (fileInfo.Length > 8000000)
		{
			throw new InvalidDataException("方案文件超过 8 MB 限制");
		}
		using FileStream fileStream = fileInfo.OpenRead();
		using MemoryStream memoryStream = new MemoryStream();
		byte[] array = new byte[8192];
		int num;
		while ((num = fileStream.Read(array, 0, array.Length)) > 0)
		{
			if (memoryStream.Length + num > 8000000)
			{
				throw new InvalidDataException("方案文件超过 8 MB 限制");
			}
			memoryStream.Write(array, 0, num);
		}
		JsonNode jsonNode = JsonNode.Parse(Encoding.UTF8.GetString(memoryStream.ToArray()).TrimStart('\ufeff'));
		if (jsonNode is JsonArray result)
		{
			return result;
		}
		if (jsonNode is JsonObject jsonObject && jsonObject["schemaVersion"] is JsonValue jsonValue && (!jsonValue.TryGetValue<int>(out var value) || value != 1))
		{
			throw new InvalidDataException("此方案文件版本暂不支持，请先更新客户端");
		}
		return ((jsonNode as JsonObject)?["plans"] as JsonArray) ?? throw new InvalidDataException("文件没有有效方案列表");
	}

	public void Write(string selectedFile, JsonArray plans)
	{
		string text = storage.ValidatePath(selectedFile);
		if (!text.EndsWith(".pokebonk-plan.json", StringComparison.OrdinalIgnoreCase))
		{
			throw new InvalidDataException("请使用 .pokebonk-plan.json 方案文件名，避免覆盖客户端其他文件");
		}
		storage.EnsureDirectory(Path.GetDirectoryName(text));
		string path = storage.ValidatePath(text + ".pending");
		string text2 = new JsonObject
		{
			["schemaVersion"] = 1,
			["product"] = "PokeBonk Pilot",
			["plans"] = plans.DeepClone()
		}.ToJsonString(new JsonSerializerOptions
		{
			WriteIndented = true
		});
		if (Encoding.UTF8.GetByteCount(text2) > 8000000)
		{
			throw new InvalidDataException("方案文件超过 8 MB 限制");
		}
		try
		{
			File.WriteAllText(path, text2, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
			File.Move(storage.ValidatePath(path), storage.ValidatePath(text), overwrite: true);
		}
		finally
		{
			if (File.Exists(path))
			{
				File.Delete(storage.ValidatePath(path));
			}
		}
	}

	public static (JsonArray Plans, int Added, int Duplicates, int Renamed) Merge(JsonArray existing, JsonArray imported)
	{
		JsonArray jsonArray = existing.DeepClone().AsArray();
		int num = 0;
		int num2 = 0;
		int num3 = 0;
		foreach (JsonObject item in imported.OfType<JsonObject>())
		{
			JsonObject plan = item.DeepClone().AsObject();
			JsonObject jsonObject = jsonArray.OfType<JsonObject>().FirstOrDefault((JsonObject p) => p["id"]?.ToString() == plan["id"]?.ToString());
			if (jsonObject != null && JsonNode.DeepEquals(jsonObject, plan))
			{
				num2++;
				continue;
			}
			if (jsonObject != null)
			{
				plan["id"] = "custom-" + Guid.NewGuid().ToString("N");
				num3++;
			}
			jsonArray.Add(plan);
			num++;
		}
		return (Plans: jsonArray, Added: num, Duplicates: num2, Renamed: num3);
	}
}
