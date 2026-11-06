using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace PokeBonk.Client;

internal sealed class WecomStorage
{
	private readonly PortableStorage portable;

	private readonly IWecomProtector protector;

	private readonly SemaphoreSlim gate = new SemaphoreSlim(1, 1);

	internal string DirectoryPath => portable.DataPath("wecom-push");

	private string PathOf(string file)
	{
		return portable.ValidatePath(Path.Combine(DirectoryPath, file));
	}

	internal WecomStorage(PortableStorage portable, IWecomProtector? protector = null)
	{
		this.portable = portable;
		this.protector = protector ?? new WecomDpapi();
	}

	internal static Uri ValidateWebhook(string value)
	{
		if (!Uri.TryCreate(value, UriKind.Absolute, out Uri result) || result.Scheme != "https" || result.IdnHost != "qyapi.weixin.qq.com" || result.Port != 443 || result.UserInfo.Length > 0 || result.Fragment.Length > 0 || result.AbsolutePath != "/cgi-bin/webhook/send" || !Regex.IsMatch(result.Query, "^\\?key=[A-Za-z0-9_-]{8,256}$", RegexOptions.CultureInvariant))
		{
			throw new InvalidOperationException("请输入企业微信官方消息推送Webhook地址；只接受qyapi.weixin.qq.com的HTTPS接口");
		}
		return result;
	}

	private async Task<JsonObject> Secrets()
	{
		string text = PathOf("secrets.dat");
		if (!File.Exists(text))
		{
			return new JsonObject();
		}
		if (new FileInfo(text).Length > 256000)
		{
			throw new IOException("推送密钥文件过大，已拒绝读取");
		}
		return (JsonNode.Parse(await File.ReadAllTextAsync(text, Encoding.UTF8)) as JsonObject) ?? throw new IOException("推送密钥文件格式异常");
	}

	private async Task Atomic(string name, string text)
	{
		portable.EnsureDirectory(DirectoryPath);
		string path = PathOf(name);
		string pending = PathOf(name + ".pending-" + Guid.NewGuid().ToString("N"));
		try
		{
			await File.WriteAllTextAsync(pending, text, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
			File.Move(portable.ValidatePath(pending), portable.ValidatePath(path), overwrite: true);
		}
		finally
		{
			if (File.Exists(pending))
			{
				File.Delete(portable.ValidatePath(pending));
			}
		}
	}

	internal async Task<JsonArray> TargetsAsync()
	{
		await gate.WaitAsync();
		try
		{
			return new JsonArray((await Secrets()).Where<KeyValuePair<string, JsonNode>>((KeyValuePair<string, JsonNode> x) => WecomSettings.ValidId(x.Key) && x.Value is JsonObject).Select((Func<KeyValuePair<string, JsonNode>, JsonNode>)delegate(KeyValuePair<string, JsonNode> x)
			{
				JsonObject obj = new JsonObject
				{
					["id"] = x.Key,
					["name"] = WecomSettings.Short(x.Value["name"], 48)
				};
				JsonNode? jsonNode = x.Value["secret"];
				obj["configured"] = jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.String;
				return obj;
			}).ToArray());
		}
		finally
		{
			gate.Release();
		}
	}

	internal async Task<WecomTarget?> ResolveAsync(string id)
	{
		if (!WecomSettings.ValidId(id))
		{
			return null;
		}
		await gate.WaitAsync();
		try
		{
			if (!((await Secrets())[id] is JsonObject jsonObject))
			{
				return null;
			}
			byte[] array = null;
			try
			{
				array = protector.Unprotect(Convert.FromBase64String(WecomSettings.Text(jsonObject["secret"])));
				string text = Encoding.UTF8.GetString(array);
				ValidateWebhook(text);
				return new WecomTarget(id, WecomSettings.Short(jsonObject["name"], 48), text);
			}
			catch (Exception ex) when (((ex is CryptographicException || ex is FormatException) ? 1 : 0) != 0)
			{
				throw new InvalidOperationException("接收目标密钥不适用于当前Windows用户，请重新配置");
			}
			finally
			{
				if (array != null)
				{
					CryptographicOperations.ZeroMemory(array);
				}
			}
		}
		finally
		{
			gate.Release();
		}
	}

	internal async Task<string> SaveTargetAsync(string? id, string name, string webhook)
	{
		ValidateWebhook(webhook);
		id = ((id == null || id.Length == 0) ? Guid.NewGuid().ToString("N") : id);
		if (!WecomSettings.ValidId(id))
		{
			throw new InvalidOperationException("接收目标编号无效");
		}
		name = new string(name.Where((char c) => !char.IsControl(c)).Take(48).ToArray());
		if (name.Length == 0)
		{
			name = "企微接收群";
		}
		await gate.WaitAsync();
		try
		{
			JsonObject jsonObject = await Secrets();
			if (!jsonObject.ContainsKey(id) && jsonObject.Count >= 16)
			{
				throw new InvalidOperationException("最多保存16个接收目标");
			}
			byte[] bytes = Encoding.UTF8.GetBytes(webhook);
			try
			{
				jsonObject[id] = new JsonObject
				{
					["name"] = name,
					["secret"] = Convert.ToBase64String(protector.Protect(bytes))
				};
			}
			finally
			{
				CryptographicOperations.ZeroMemory(bytes);
			}
			await Atomic("secrets.dat", jsonObject.ToJsonString());
			return id;
		}
		finally
		{
			gate.Release();
		}
	}

	internal async Task DeleteTargetAsync(string id)
	{
		if (!WecomSettings.ValidId(id))
		{
			throw new InvalidOperationException("接收目标编号无效");
		}
		await gate.WaitAsync();
		try
		{
			JsonObject jsonObject = await Secrets();
			if (jsonObject.Remove(id))
			{
				await Atomic("secrets.dat", jsonObject.ToJsonString());
			}
		}
		finally
		{
			gate.Release();
		}
	}

	private IEnumerable<JsonObject> ReadHistory()
	{
		string path = PathOf("history.jsonl");
		if (!File.Exists(path))
		{
			yield break;
		}
		using StreamReader input = new StreamReader(File.Open(portable.ValidatePath(path), FileMode.Open, FileAccess.Read, FileShare.Read), Encoding.UTF8);
		while (true)
		{
			string text = input.ReadLine();
			if (text == null)
			{
				break;
			}
			if (text.Length <= 20000)
			{
				JsonObject jsonObject = null;
				try
				{
					jsonObject = JsonNode.Parse(text) as JsonObject;
				}
				catch (JsonException)
				{
				}
				if (jsonObject != null)
				{
					yield return jsonObject;
				}
			}
		}
	}

	internal Task<string?> AppendHistoryAsync(JsonObject entry, JsonObject settings, DateTimeOffset now)
	{
		return Task.Run(async delegate
		{
			string mode = WecomSettings.Text(settings["mode"], "count");
			if (mode == "none")
			{
				return (string)null;
			}
			await gate.WaitAsync();
			try
			{
				string text = PathOf("history.jsonl");
				long cap = (long)WecomSettings.Number(settings["maxMiB"], 50, 1, 1024) * 1024L * 1024;
				string text2 = mode;
				bool flag = ((text2 == "permanent" || text2 == "summary") ? true : false);
				if (flag && File.Exists(text) && new FileInfo(text).Length + 20000 > cap)
				{
					return "历史容量已满，保留旧记录并暂停新增历史；发送仍继续";
				}
				JsonObject jsonObject = entry.DeepClone().AsObject();
				if (mode == "summary")
				{
					jsonObject.Remove("body");
				}
				string text3 = "";
				string repaired = null;
				if (File.Exists(text) && new FileInfo(text).Length > 0)
				{
					using FileStream fileStream = new FileStream(portable.ValidatePath(text), FileMode.Open, FileAccess.Read, FileShare.Read);
					fileStream.Seek(-1L, SeekOrigin.End);
					if (fileStream.ReadByte() != 10)
					{
						text3 = "\n";
						repaired = "旧历史尾记录缺少换行，已隔开保留；新完整记录正常保存";
					}
				}
				portable.EnsureDirectory(DirectoryPath);
				await File.AppendAllTextAsync(text, text3 + jsonObject.ToJsonString() + "\n", new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
				switch (mode)
				{
				case "count":
				case "days":
				case "both":
					flag = true;
					break;
				default:
					flag = false;
					break;
				}
				if (flag)
				{
					int num = WecomSettings.Number(settings["count"], 100, 1, 100000);
					int num2 = WecomSettings.Number(settings["days"], 30, 1, 3650);
					Queue<string> queue = new Queue<string>();
					long num3 = 0L;
					foreach (JsonObject item in ReadHistory())
					{
						text2 = mode;
						flag = ((text2 == "days" || text2 == "both") ? true : false);
						if (!flag || !DateTimeOffset.TryParse(WecomSettings.Text(item["at"]), out var result) || !(result < now.AddDays(-num2)))
						{
							string text4 = item.ToJsonString();
							queue.Enqueue(text4);
							num3 += Encoding.UTF8.GetByteCount(text4) + 1;
							while (true)
							{
								flag = queue.Count > 0;
								if (flag)
								{
									text2 = mode;
									bool flag2 = ((text2 == "count" || text2 == "both") ? true : false);
									flag = (flag2 && queue.Count > num) || num3 > cap;
								}
								if (!flag)
								{
									break;
								}
								num3 -= Encoding.UTF8.GetByteCount(queue.Dequeue()) + 1;
							}
						}
					}
					await Atomic("history.jsonl", string.Join('\n', queue) + ((queue.Count > 0) ? "\n" : ""));
				}
				return repaired;
			}
			finally
			{
				gate.Release();
			}
		});
	}

	internal Task<JsonObject> HistoryAsync(int offset, int limit, string? state = null)
	{
		return Task.Run(async delegate
		{
			state = (string.IsNullOrWhiteSpace(state) ? null : state);
			offset = Math.Clamp(offset, 0, 100000);
			limit = Math.Clamp(limit, 1, 10000);
			await gate.WaitAsync();
			try
			{
				long num = 0L;
				foreach (JsonObject item in ReadHistory())
				{
					if (Matches(item))
					{
						num++;
					}
				}
				long num2 = Math.Max(0L, num - offset - limit);
				long num3 = Math.Max(0L, num - offset);
				long num4 = 0L;
				List<JsonObject> list = new List<JsonObject>(limit);
				foreach (JsonObject item2 in ReadHistory())
				{
					if (Matches(item2))
					{
						if (num4 >= num2 && num4 < num3)
						{
							list.Add(item2);
						}
						num4++;
						if (num4 >= num3)
						{
							break;
						}
					}
				}
				list.Reverse();
				return new JsonObject
				{
					["entries"] = new JsonArray(((IEnumerable<JsonObject>)list).Select((Func<JsonObject, JsonNode>)((JsonObject x) => x)).ToArray()),
					["total"] = num,
					["offset"] = offset,
					["limit"] = limit,
					["message"] = "清理的是本机推送记录，不会撤回或删除企业微信群中已经发送的消息。"
				};
			}
			finally
			{
				gate.Release();
			}
		});
		bool Matches(JsonObject row)
		{
			if (state != null)
			{
				return WecomSettings.Text(row["state"]) == state;
			}
			return true;
		}
	}

	internal async Task ClearHistoryAsync()
	{
		await gate.WaitAsync();
		try
		{
			string path = PathOf("history.jsonl");
			if (File.Exists(path))
			{
				File.Delete(path);
			}
		}
		finally
		{
			gate.Release();
		}
	}

	internal Task<string> ExportHistoryAsync(string? state = null)
	{
		return Task.Run(async delegate
		{
			JsonObject jsonObject = await HistoryAsync(0, 10000, state);
			string name = "history-export-" + DateTimeOffset.Now.ToString("yyyyMMdd-HHmmss") + ".json";
			await Atomic(name, jsonObject.ToJsonString(new JsonSerializerOptions
			{
				WriteIndented = true
			}));
			return PathOf(name);
		});
	}
}
