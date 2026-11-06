using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace PokeBonk.Client;

internal sealed class CompatibilityOverridesStore(PortableStorage storage)
{
	internal const int MaximumBytes = 262144;

	private readonly object sync = new object();

	private JsonObject current = Empty();

	private string? loadedHash;

	private bool loaded;

	private bool unreadable;

	internal string? ReadWarning { get; private set; }

	internal string FilePath => storage.DataPath("compatibility-overrides.json");

	internal static JsonObject Empty()
	{
		return new JsonObject
		{
			["schemaVersion"] = 1,
			["revision"] = 0L,
			["interfaces"] = new JsonObject(),
			["other"] = new JsonObject()
		};
	}

	internal JsonObject Read()
	{
		lock (sync)
		{
			if (!loaded)
			{
				Load();
			}
			return current.DeepClone().AsObject();
		}
	}

	internal JsonObject Reload()
	{
		lock (sync)
		{
			Load();
			return current.DeepClone().AsObject();
		}
	}

	internal int Integer(string id, int fallback, int minimum, int maximum)
	{
		lock (sync)
		{
			if (!loaded)
			{
				Load();
			}
			int value;
			return (current["other"]?[id] is JsonValue jsonValue && jsonValue.TryGetValue<int>(out value) && value >= minimum && value <= maximum) ? value : fallback;
		}
	}

	internal string? Interface(string id)
	{
		lock (sync)
		{
			if (!loaded)
			{
				Load();
			}
			string value;
			return (current["interfaces"]?[id] is JsonValue jsonValue && jsonValue.TryGetValue<string>(out value)) ? value : null;
		}
	}

	private void Load()
	{
		loaded = true;
		current = Empty();
		ReadWarning = null;
		unreadable = false;
		string text = storage.ValidatePath(FilePath);
		try
		{
			loadedHash = HashExisting(text);
			if (loadedHash != null)
			{
				if (new FileInfo(text).Length > 262144)
				{
					throw new InvalidDataException();
				}
				string json = File.ReadAllText(storage.ValidatePath(text), new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true));
				JsonDocumentOptions documentOptions = new JsonDocumentOptions
				{
					MaxDepth = 16
				};
				current = Normalize(JsonNode.Parse(json, null, documentOptions));
			}
		}
		catch (Exception ex) when (((ex is IOException || ex is UnauthorizedAccessException || ex is JsonException || ex is InvalidDataException || ex is InvalidOperationException || ex is DecoderFallbackException || ex is FormatException) ? 1 : 0) != 0)
		{
			unreadable = true;
			ReadWarning = "兼容配置未能读取，已保留原文件并使用自动识别；可在此窗口重置兼容配置，不影响账号和游戏存档。";
		}
	}

	internal JsonObject Save(JsonNode? value, long expectedRevision, bool reset = false)
	{
		lock (sync)
		{
			if (!loaded)
			{
				Load();
			}
			string path = storage.ValidatePath(FilePath);
			if (expectedRevision != Revision(current) || !StringComparer.Ordinal.Equals(loadedHash, HashExisting(path)))
			{
				throw new InvalidOperationException("兼容配置已被其他操作更新，请重新读取后再保存；本次没有覆盖新配置。");
			}
			if (unreadable && !reset)
			{
				throw new InvalidOperationException(ReadWarning + "请先点击重置，再重新填写。");
			}
			JsonObject jsonObject = Normalize(value);
			jsonObject["revision"] = checked(Revision(current) + 1);
			byte[] bytes = Encoding.UTF8.GetBytes(jsonObject.ToJsonString());
			if (bytes.Length > 262144)
			{
				throw new InvalidOperationException("兼容配置内容过大，请减少重复配置。");
			}
			string path2 = storage.DataPath("temp/compatibility-" + Guid.NewGuid().ToString("N") + ".pending");
			try
			{
				using (FileStream fileStream = new FileStream(storage.ValidatePath(path2), FileMode.CreateNew, FileAccess.Write, FileShare.None))
				{
					fileStream.Write(bytes);
					fileStream.Flush(flushToDisk: true);
				}
				if (!StringComparer.Ordinal.Equals(loadedHash, HashExisting(path)))
				{
					throw new InvalidOperationException("兼容配置文件刚刚发生变化，请重新读取后再保存。");
				}
				File.Move(storage.ValidatePath(path2), storage.ValidatePath(path), overwrite: true);
				current = jsonObject;
				loadedHash = Convert.ToHexString(SHA256.HashData(bytes));
				unreadable = false;
				ReadWarning = null;
				return current.DeepClone().AsObject();
			}
			finally
			{
				if (File.Exists(path2))
				{
					File.Delete(storage.ValidatePath(path2));
				}
			}
		}
	}

	internal static bool TryRevision(JsonNode? value, out long revision)
	{
		revision = 0L;
		if (!(value is JsonValue jsonValue))
		{
			return false;
		}
		if (!jsonValue.TryGetValue<long>(out revision))
		{
			if (!jsonValue.TryGetValue<int>(out var value2))
			{
				return false;
			}
			revision = value2;
		}
		long num = revision;
		if (num >= 0)
		{
			return num <= 9007199254740991L;
		}
		return false;
	}

	internal static long Revision(JsonNode? value)
	{
		if (!TryRevision(value?["revision"], out var revision))
		{
			return 0L;
		}
		return revision;
	}

	internal static JsonObject Normalize(JsonNode? value)
	{
		if (!(value is JsonObject jsonObject) || !(jsonObject["schemaVersion"] is JsonValue jsonValue) || !jsonValue.TryGetValue<int>(out var value2) || value2 != 1)
		{
			throw new InvalidOperationException("兼容配置格式无效：需要 schemaVersion 为 1 的配置对象。");
		}
		if (jsonObject.Any<KeyValuePair<string, JsonNode>>(delegate(KeyValuePair<string, JsonNode> entry)
		{
			bool flag;
			switch (entry.Key)
			{
			case "schemaVersion":
			case "revision":
			case "interfaces":
			case "other":
				flag = true;
				break;
			default:
				flag = false;
				break;
			}
			return !flag;
		}))
		{
			throw new InvalidOperationException("兼容配置只能包含公开接口和兼容参数，不能混入账号、存档或其他文件内容。");
		}
		if (jsonObject["revision"] != null && !TryRevision(jsonObject["revision"], out var _))
		{
			throw new InvalidOperationException("兼容配置版本号无效。");
		}
		JsonObject jsonObject2 = Empty();
		jsonObject2["revision"] = Revision(jsonObject);
		string[] array = new string[2] { "interfaces", "other" };
		foreach (string text in array)
		{
			if (!(jsonObject[text] is JsonObject { Count: <=4096 } jsonObject3))
			{
				throw new InvalidOperationException("兼容配置的接口或其他参数格式无效。");
			}
			JsonObject jsonObject4 = jsonObject2[text].AsObject();
			foreach (KeyValuePair<string, JsonNode> item in jsonObject3)
			{
				if (!ValidId(item.Key))
				{
					throw new InvalidOperationException("兼容配置名称无效，请使用窗口提供的项目名称。");
				}
				if (text == "interfaces" && item.Value != null && (!(item.Value is JsonValue jsonValue2) || !jsonValue2.TryGetValue<string>(out string _)))
				{
					throw new InvalidOperationException("接口位置必须是文本；清空表示恢复自动识别。");
				}
				ValidateValue(item.Value, 0);
				if (item.Value != null && (!(item.Value is JsonValue jsonValue3) || !jsonValue3.TryGetValue<string>(out string value4) || !string.IsNullOrWhiteSpace(value4)))
				{
					jsonObject4[item.Key] = item.Value.DeepClone();
				}
			}
		}
		if (Encoding.UTF8.GetByteCount(jsonObject2.ToJsonString()) > 262144)
		{
			throw new InvalidOperationException("兼容配置内容过大。");
		}
		return jsonObject2;
	}

	internal static bool ValidId(string value)
	{
		bool flag = Regex.IsMatch(value, "^[A-Za-z][A-Za-z0-9._:-]{0,127}$", RegexOptions.CultureInvariant);
		if (flag)
		{
			bool flag2;
			switch (value)
			{
			case "__proto__":
			case "prototype":
			case "constructor":
				flag2 = true;
				break;
			default:
				flag2 = false;
				break;
			}
			flag = !flag2;
		}
		return flag;
	}

	private static void ValidateValue(JsonNode? value, int depth)
	{
		if (depth > 8)
		{
			throw new InvalidOperationException("兼容参数层级过深。");
		}
		if (value == null)
		{
			return;
		}
		if (value is JsonObject jsonObject)
		{
			if (jsonObject.Count > 512)
			{
				throw new InvalidOperationException("兼容参数包含过多项目。");
			}
			{
				foreach (KeyValuePair<string, JsonNode> item in jsonObject)
				{
					if (!ValidId(item.Key))
					{
						throw new InvalidOperationException("兼容参数键名无效。");
					}
					ValidateValue(item.Value, depth + 1);
				}
				return;
			}
		}
		if (value is JsonArray jsonArray)
		{
			if (jsonArray.Count > 4096)
			{
				throw new InvalidOperationException("兼容参数列表过长。");
			}
			{
				foreach (JsonNode item2 in jsonArray)
				{
					ValidateValue(item2, depth + 1);
				}
				return;
			}
		}
		if (!(value is JsonValue jsonValue))
		{
			throw new InvalidOperationException("兼容参数值无效。");
		}
		if (jsonValue.TryGetValue<string>(out string value2))
		{
			if (value2.Length <= 8192 && !value2.Any(delegate(char c)
			{
				bool flag2 = c == '\0';
				if (!flag2)
				{
					bool flag3 = char.IsControl(c);
					if (flag3)
					{
						bool flag4;
						switch (c)
						{
						case '\t':
						case '\n':
						case '\r':
							flag4 = true;
							break;
						default:
							flag4 = false;
							break;
						}
						flag3 = !flag4;
					}
					flag2 = flag3;
				}
				return flag2;
			}))
			{
				return;
			}
			throw new InvalidOperationException("兼容参数文本过长或含无效字符。");
		}
		JsonValueKind valueKind = jsonValue.GetValueKind();
		bool flag = valueKind - 5 <= JsonValueKind.Object;
		if (flag || jsonValue.TryGetValue<int>(out var _) || (jsonValue.TryGetValue<long>(out var value4) && value4 >= -1000000000000L && value4 <= 1000000000000L) || (jsonValue.TryGetValue<decimal>(out var value5) && value5 >= -1000000000000m && value5 <= 1000000000000m) || (jsonValue.TryGetValue<float>(out var value6) && float.IsFinite(value6) && (double)Math.Abs(value6) <= 1000000000000.0) || (jsonValue.TryGetValue<double>(out var value7) && double.IsFinite(value7) && Math.Abs(value7) <= 1000000000000.0))
		{
			return;
		}
		throw new InvalidOperationException("兼容参数只接受有限数字、文本、开关和公开结构数据。");
	}

	private static string? HashExisting(string path)
	{
		if (!File.Exists(path))
		{
			return null;
		}
		using FileStream fileStream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
		if (fileStream.Length > 262144)
		{
			return "oversize:" + fileStream.Length;
		}
		return Convert.ToHexString(SHA256.HashData(fileStream));
	}
}
