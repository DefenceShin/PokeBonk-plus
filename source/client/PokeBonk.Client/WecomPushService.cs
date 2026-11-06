using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace PokeBonk.Client;

internal sealed class WecomPushService : IDisposable
{
	private sealed class Pending
	{
		internal required string Id;

		internal required string Group;

		internal required string Target;

		internal required string Body;

		internal required string[] Items;

		internal int Part;

		internal int Parts;

		internal int Count;

		internal int Attempts;

		internal long Earliest;

		internal DateTimeOffset At;

		internal long Epoch;
	}

	private sealed class Summary
	{
		internal required string Item;

		internal required string Target;

		internal readonly List<JsonObject> Facts = new List<JsonObject>();

		internal DateTimeOffset Next;

		internal string LastSlot = "";

		internal int Lost;

		internal int Bytes;
	}

	private readonly JsonObject config;

	private readonly IReadOnlyDictionary<string, JsonObject> selected;

	private readonly IReadOnlyDictionary<string, WecomTarget> targets;

	private readonly WecomStorage storage;

	private readonly IWecomTransport transport;

	private readonly IWecomClock clock;

	private readonly WecomRateBudget budget;

	private readonly object gate = new object();

	private readonly SemaphoreSlim wake = new SemaphoreSlim(0, 1);

	private readonly CancellationTokenSource cancelled = new CancellationTokenSource();

	private CancellationTokenSource scopeCancellation = new CancellationTokenSource();

	private readonly List<Pending> queue = new List<Pending>();

	private readonly Dictionary<string, Summary> summaries = new Dictionary<string, Summary>(StringComparer.Ordinal);

	private readonly HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);

	private readonly Queue<string> seenOrder = new Queue<string>();

	private Task? worker;

	private string? identity;

	private long epoch = 1L;

	private bool disposed;

	private int queuedBytes;

	private int summaryBytes;

	private long sent;

	private long failed;

	private long unknown;

	private long cancelledCount;

	private long overflow;

	private string lastStatus = "等待已开启项目的实际事件";

	private string storageWarning = "";

	private double rateWait;

	internal string Generation { get; }

	internal bool RequiresGameObservation => selected.Any<KeyValuePair<string, JsonObject>>((KeyValuePair<string, JsonObject> x) => WecomSettings.Text(WecomSettings.Items[x.Key]["producer"]) == "game" || WecomSettings.Text(WecomSettings.Items[x.Key]["source"]?["adapter"]).StartsWith("host-saved-", StringComparison.Ordinal));

	internal WecomPushService(JsonObject settings, IReadOnlyDictionary<string, WecomTarget> targets, WecomStorage storage, string generation, IWecomTransport? transport = null, IWecomClock? clock = null, WecomRateBudget? budget = null, bool startWorker = true)
	{
		WecomPushService wecomPushService = this;
		config = WecomSettings.Normalize(settings);
		selected = (from x in WecomSettings.Selected(config)
			where targets.ContainsKey(wecomPushService.Target(x.Value))
			select x).ToDictionary<KeyValuePair<string, JsonObject>, string, JsonObject>((KeyValuePair<string, JsonObject> x) => x.Key, (KeyValuePair<string, JsonObject> x) => x.Value, StringComparer.Ordinal);
		this.targets = targets;
		this.storage = storage;
		Generation = generation;
		if (!WecomSettings.Yes(config["enabled"]) || selected.Count == 0 || !selected.Any<KeyValuePair<string, JsonObject>>((KeyValuePair<string, JsonObject> x) => targets.ContainsKey(wecomPushService.Target(x.Value))))
		{
			throw new InvalidOperationException("推送未具备有效项目和接收目标，不应启动服务");
		}
		this.clock = clock ?? new WecomClock();
		this.budget = budget ?? WecomRateBudget.Shared;
		this.transport = transport ?? new WecomHttpTransport(config["network"].AsObject());
		foreach (KeyValuePair<string, JsonObject> item in selected)
		{
			string text = Target(item.Value);
			if (targets.ContainsKey(text) && !(WecomSettings.Text(item.Value["delivery"]) == "instant"))
			{
				Summary summary = new Summary
				{
					Item = item.Key,
					Target = text
				};
				summary.Next = Next(item.Value, this.clock.Now);
				summaries[item.Key] = summary;
			}
		}
		if (startWorker)
		{
			worker = Task.Run((Func<Task?>)Loop);
		}
	}

	private string Target(JsonObject item)
	{
		return WecomSettings.Text(item["targetId"], WecomSettings.Text(config["targetId"]));
	}

	internal JsonObject CollectorConfiguration()
	{
		return new JsonObject
		{
			["generation"] = Generation,
			["observeManual"] = WecomSettings.Yes(config["observeManual"]),
			["allowTeamDetails"] = WecomSettings.Yes(config["allowTeamDetails"]),
			["identityOnly"] = selected.Any<KeyValuePair<string, JsonObject>>((KeyValuePair<string, JsonObject> x) => WecomSettings.Text(WecomSettings.Items[x.Key]["source"]?["adapter"]).StartsWith("host-saved-", StringComparison.Ordinal)),
			["items"] = new JsonObject(selected.Where<KeyValuePair<string, JsonObject>>((KeyValuePair<string, JsonObject> x) => WecomSettings.Text(WecomSettings.Items[x.Key]["producer"]) == "game").Select(delegate(KeyValuePair<string, JsonObject> x)
			{
				string key = x.Key;
				JsonObject jsonObject = new JsonObject { ["fields"] = x.Value["fields"]?.DeepClone() ?? new JsonArray() };
				JsonObject jsonObject2 = jsonObject;
				string text = WecomSettings.Text(x.Value["filter"]);
				bool flag = ((text == "new" || text == "repeat") ? true : false);
				jsonObject2["needsNovelty"] = flag || !WecomSettings.Yes(x.Value["includeUnknown"]);
				return KeyValuePair.Create(key, (JsonNode)jsonObject);
			}))
		};
	}

	private static DateTimeOffset Next(JsonObject item, DateTimeOffset now)
	{
		if (WecomSettings.Text(item["delivery"]) != "fixed")
		{
			long num = (long)WecomSettings.Number(item["intervalMinutes"], 30, 1, 10080) * 60L;
			return DateTimeOffset.FromUnixTimeSeconds((now.ToUnixTimeSeconds() / num + 1) * num);
		}
		DateTimeOffset dateTimeOffset = now.ToOffset(TimeSpan.FromHours(8.0));
		TimeSpan timeSpan = TimeSpan.ParseExact(WecomSettings.Text(item["at"], "09:00"), "hh\\:mm", CultureInfo.InvariantCulture);
		HashSet<int> hashSet = ((item["days"] as JsonArray) ?? new JsonArray()).Select((JsonNode x) => WecomSettings.Number(x, 0, 0, 7)).ToHashSet();
		for (int num2 = 0; num2 <= 7; num2++)
		{
			DateTime dateTime = dateTimeOffset.Date.AddDays(num2);
			DateTimeOffset dateTimeOffset2 = new DateTimeOffset(dateTime + timeSpan, TimeSpan.FromHours(8.0));
			int item2 = (int)((dateTime.DayOfWeek == DayOfWeek.Sunday) ? ((DayOfWeek)7) : dateTime.DayOfWeek);
			if (dateTimeOffset2 > now && hashSet.Contains(item2))
			{
				return dateTimeOffset2;
			}
		}
		return DateTimeOffset.MaxValue;
	}

	internal void AcceptBatch(JsonObject batch)
	{
		lock (gate)
		{
			if (disposed || WecomSettings.Text(batch["generation"]) != Generation)
			{
				return;
			}
			string text = WecomSettings.Text(batch["identityScope"]);
			if (text.Length == 0)
			{
				ChangeIdentity(null);
				return;
			}
			if (text.Length > 128 || !Regex.IsMatch(text, "^[A-Za-z0-9_.:-]+$"))
			{
				return;
			}
			ChangeIdentity(text);
			Dictionary<string, List<JsonObject>> dictionary = new Dictionary<string, List<JsonObject>>(StringComparer.Ordinal);
			if (batch["facts"] is JsonArray { Count: >512 } jsonArray)
			{
				overflow += jsonArray.Count - 512;
			}
			foreach (JsonObject item2 in ((batch["facts"] as JsonArray) ?? new JsonArray()).Take(512).OfType<JsonObject>())
			{
				string text2 = WecomSettings.Text(item2["itemId"]);
				if (!selected.TryGetValue(text2, out JsonObject value) || WecomSettings.Text(item2["identityScope"]) != identity)
				{
					continue;
				}
				string text3 = WecomSettings.Short(item2["eventId"], 180);
				if (text3.Length == 0)
				{
					continue;
				}
				string item = text2 + ":" + text3 + ":" + WecomSettings.Short(item2["phase"], 40);
				if (!seen.Add(item))
				{
					continue;
				}
				seenOrder.Enqueue(item);
				while (seenOrder.Count > 8192)
				{
					seen.Remove(seenOrder.Dequeue());
				}
				if (!Passes(item2, value))
				{
					continue;
				}
				JsonObject jsonObject = SafeFact(item2, text2, value);
				string key = Target(value);
				if (!targets.ContainsKey(key))
				{
					continue;
				}
				int byteCount = Encoding.UTF8.GetByteCount(jsonObject.ToJsonString());
				if (byteCount > 8192)
				{
					overflow++;
					lastStatus = "所选事实超过8KiB明细上限，未保留数已计入溢出";
					continue;
				}
				string text4 = WecomSettings.Text(value["delivery"]);
				if ((text4 == "instant" || text4 == "both") ? true : false)
				{
					if (!dictionary.TryGetValue(key, out var value2))
					{
						value2 = (dictionary[key] = new List<JsonObject>());
					}
					value2.Add(jsonObject);
				}
				if (summaries.TryGetValue(text2, out Summary value3))
				{
					if (value3.Facts.Count < 2048 && summaryBytes + byteCount <= 2097152)
					{
						value3.Facts.Add(jsonObject);
						value3.Bytes += byteCount;
						summaryBytes += byteCount;
					}
					else
					{
						value3.Lost++;
						overflow++;
						lastStatus = "定时摘要达到全局2MiB上限，未保留的明细已计入溢出";
					}
				}
			}
			overflow += WecomSettings.Number(batch["overflow"], 0, 0, int.MaxValue);
			foreach (KeyValuePair<string, List<JsonObject>> item3 in dictionary)
			{
				Enqueue(item3.Key, item3.Value);
			}
		}
		Signal();
	}

	private void ChangeIdentity(string? scope)
	{
		if (identity == scope)
		{
			return;
		}
		scopeCancellation.Cancel();
		scopeCancellation.Dispose();
		scopeCancellation = new CancellationTokenSource();
		epoch++;
		cancelledCount += queue.Count;
		queue.Clear();
		queuedBytes = 0;
		seen.Clear();
		seenOrder.Clear();
		identity = scope;
		foreach (Summary value in summaries.Values)
		{
			value.Facts.Clear();
			value.Lost = (value.Bytes = 0);
		}
		summaryBytes = 0;
		lastStatus = ((scope == null) ? "身份未知，停止采集与发送" : "已切换匿名身份并建立新基线；旧身份待发已取消");
	}

	private static bool Passes(JsonObject raw, JsonObject item)
	{
		string text = WecomSettings.Text(raw["novelty"], "unknown");
		string text2 = WecomSettings.Text(item["filter"], "all");
		bool flag = WecomSettings.Yes(item["includeUnknown"]);
		if ((text == "unknown" && !flag) || (text2 != "all" && text != text2 && !(text == "unknown" && flag)))
		{
			return false;
		}
		if (item["objectIds"] is JsonArray { Count: >0 } jsonArray && !jsonArray.Any((JsonNode x) => WecomSettings.Text(x) == WecomSettings.Text(raw["objectId"])))
		{
			return false;
		}
		JsonObject jsonObject = raw["data"] as JsonObject;
		string text3 = WecomSettings.Text(item["direction"], "any");
		double value;
		double num = (WecomSettings.Real(item["minChange"], out value) ? value : 0.0);
		if (text3 == "any" && num == 0.0)
		{
			return true;
		}
		if (!WecomSettings.Real(jsonObject?["delta"], out var value2))
		{
			return false;
		}
		if (Math.Abs(value2) >= num)
		{
			if (!(text3 == "any") && (!(text3 == "increase") || !(value2 > 0.0)))
			{
				if (text3 == "decrease")
				{
					return value2 < 0.0;
				}
				return false;
			}
			return true;
		}
		return false;
	}

	private static string Phase(string value)
	{
		switch (value)
		{
		case "saved":
			return "已核验保存";
		case "captured":
		case "run-caught":
			return "本局捕获，待结算保存";
		case "verified":
			return "已核验资料";
		case "receipt":
			return "原生操作回执";
		case "host-observed":
			return "客户端观察";
		case "observed":
			return "当前观察";
		case "encounter":
			return "发现目标";
		case "available":
			return "当前可用";
		case "started":
			return "已开始";
		case "failed":
			return "未完成";
		case "escaped":
			return "已逃离";
		case "page-open":
			return "原生选择页已打开";
		case "native-callback-returned":
			return "原生回调已返回（不等于操作成功）";
		default:
			return "状态观察";
		}
	}

	private static string NativeState(string value)
	{
		return value switch
		{
			"open" => "选择页已打开", 
			"native-callback-returned" => "原生回调已返回（不等于操作成功）", 
			"play" => "游戏进行中", 
			"modal" => "正在处理选择页", 
			"paused" => "游戏已暂停", 
			"over" => "本局已结束", 
			"transition" => "正在切换场景", 
			"idle" => "等待中", 
			"roaming" => "目标正在游走", 
			"weakened" => "目标已虚弱", 
			"throwing" => "正在投球", 
			"capturing" => "正在判定捕获", 
			"dead" => "角色已倒下", 
			_ => "状态未知", 
		};
	}

	private static string Novelty(string value)
	{
		if (!(value == "new"))
		{
			if (value == "repeat")
			{
				return "此前已拥有／重复";
			}
			return "此前状态尚未核实";
		}
		return "本次新增／首次";
	}

	private static JsonObject SafeFact(JsonObject raw, string id, JsonObject settings)
	{
		HashSet<string> hashSet = WecomSettings.Fields(WecomSettings.Items[id]);
		HashSet<string> hashSet2 = ((settings["fields"] as JsonArray) ?? new JsonArray()).Select((JsonNode x) => WecomSettings.Text(x)).ToHashSet();
		JsonObject jsonObject = new JsonObject();
		foreach (KeyValuePair<string, JsonNode> item in ((raw["data"] as JsonObject) ?? new JsonObject()).Take(100))
		{
			if (!hashSet.Contains(item.Key) || !hashSet2.Contains(item.Key))
			{
				continue;
			}
			if (item.Value == null)
			{
				jsonObject[item.Key] = null;
			}
			else
			{
				if (!(item.Value is JsonValue jsonValue))
				{
					continue;
				}
				if (jsonValue.GetValueKind() == JsonValueKind.String)
				{
					jsonObject[item.Key] = WecomSettings.Short(jsonValue, 1000);
					continue;
				}
				JsonValueKind valueKind = jsonValue.GetValueKind();
				double value;
				if (valueKind - 5 <= JsonValueKind.Object)
				{
					jsonObject[item.Key] = jsonValue.DeepClone();
				}
				else if (WecomSettings.Real(jsonValue, out value))
				{
					jsonObject[item.Key] = value;
				}
			}
		}
		string text = WecomSettings.Text(raw["phase"]);
		string text2 = ((Phase(text) == "状态观察") ? WecomSettings.Text(WecomSettings.Items[id]["phase"], "observed") : text);
		JsonObject jsonObject2 = new JsonObject();
		jsonObject2["itemId"] = id;
		jsonObject2["phase"] = text2;
		jsonObject2["novelty"] = (new string[3] { "new", "repeat", "unknown" }.Contains(WecomSettings.Text(raw["novelty"])) ? WecomSettings.Text(raw["novelty"]) : "unknown");
		jsonObject2["objectId"] = WecomSettings.Short(raw["objectId"], 100);
		jsonObject2["observedAt"] = WecomSettings.Short(raw["observedAt"], 50);
		jsonObject2["data"] = jsonObject;
		return jsonObject2;
	}

	private string? Format(IReadOnlyList<JsonObject> facts)
	{
		StringBuilder text = new StringBuilder();
		int bytes = 0;
		Line("PokéBonk 旅伴通知" + ((WecomSettings.Text(config["alias"]).Length > 0) ? (" · " + WecomSettings.Text(config["alias"])) : ""));
		foreach (JsonObject fact in facts)
		{
			string text2 = WecomSettings.Text(fact["itemId"]);
			JsonObject jsonObject = WecomSettings.Items[text2];
			if (!Line(WecomSettings.Text(jsonObject["label"], text2) + " · " + Phase(WecomSettings.Text(fact["phase"]))))
			{
				return null;
			}
			Dictionary<string, string> dictionary = ((jsonObject["fields"] as JsonArray) ?? new JsonArray()).OfType<JsonObject>().ToDictionary((JsonObject x) => WecomSettings.Text(x["id"]), (JsonObject x) => WecomSettings.Text(x["label"], WecomSettings.Text(x["id"])));
			foreach (KeyValuePair<string, JsonNode> item in fact["data"].AsObject())
			{
				string text3 = ((item.Key == "novelty") ? Novelty(WecomSettings.Text(item.Value)) : ((item.Value is JsonValue jsonValue && jsonValue.GetValueKind() == JsonValueKind.String) ? jsonValue.GetValue<string>() : (item.Value?.ToJsonString() ?? "未知")));
				if (item.Key == "state" && item.Value != null)
				{
					string text4 = ((!(text2 == "client.state") && !(WecomSettings.Text(jsonObject["source"]?["event"]) == "clientStatus")) ? NativeState(text3) : (text3 switch
					{
						"ready" => "已就绪", 
						"running" => "辅助运行中", 
						"stopped" => "辅助已停止", 
						"disconnected" => "游戏连接中断", 
						_ => "状态未知", 
					}));
					text3 = text4;
				}
				JsonValueKind? jsonValueKind = item.Value?.GetValueKind();
				bool flag;
				if (jsonValueKind.HasValue)
				{
					JsonValueKind valueOrDefault = jsonValueKind.GetValueOrDefault();
					if (valueOrDefault - 5 <= JsonValueKind.Object)
					{
						flag = true;
						goto IL_0310;
					}
				}
				flag = false;
				goto IL_0310;
				IL_0310:
				if (flag)
				{
					text3 = (WecomSettings.Yes(item.Value) ? "是" : "否");
				}
				if (!Line("  " + dictionary.GetValueOrDefault(item.Key, item.Key) + "：" + text3))
				{
					return null;
				}
			}
		}
		return text.ToString().TrimEnd('\r', '\n');
		bool Line(string value)
		{
			int num = Encoding.UTF8.GetByteCount(value) + 1;
			if (bytes + num > 2097152)
			{
				return false;
			}
			text.AppendLine(value);
			bytes += num;
			return true;
		}
	}

	internal static IReadOnlyList<string> Split(string body, string group)
	{
		List<string> pieces = new List<string>();
		StringBuilder stringBuilder = new StringBuilder();
		int num = 0;
		foreach (Rune item in body.EnumerateRunes())
		{
			if (num + item.Utf8SequenceLength > 1900 && num > 0)
			{
				pieces.Add(stringBuilder.ToString());
				stringBuilder.Clear();
				num = 0;
			}
			stringBuilder.Append(item.ToString());
			num += item.Utf8SequenceLength;
		}
		if (stringBuilder.Length > 0)
		{
			pieces.Add(stringBuilder.ToString());
		}
		return pieces.Select((string x, int i) => "通知 " + group.Substring(0, Math.Min(8, group.Length)) + " · " + (i + 1) + "/" + pieces.Count + "\n" + x).ToArray();
	}

	private void Enqueue(string target, List<JsonObject> facts)
	{
		if (facts.Count == 0)
		{
			return;
		}
		string text = Guid.NewGuid().ToString("N");
		string text2 = Format(facts);
		int num = facts.Count;
		if (text2 == null)
		{
			overflow += facts.Count;
			lastStatus = "同批正文超过2MiB上限，未保留数已计入溢出；已有待发保持";
			return;
		}
		string[] array = facts.Select((JsonObject x) => WecomSettings.Text(x["itemId"])).Distinct().ToArray();
		Pending[] array2 = (from x in queue
			where x.Target == target && x.Epoch == epoch && x.Attempts == 0 && clock.Now - x.At <= TimeSpan.FromHours(24.0)
			group x by x.Group).FirstOrDefault((IGrouping<string, Pending> g) => g.Count() == g.First().Parts && !queue.Any((Pending x) => x.Group == g.Key && x.Attempts != 0))?.OrderBy((Pending x) => x.Part).ToArray() ?? Array.Empty<Pending>();
		if (array2.Length != 0)
		{
			text2 = string.Concat(string.Concat(array2.Select((Pending x) => x.Body.Substring(x.Body.IndexOf('\n') + 1))), "\n", text2.Substring(text2.IndexOf('\n') + 1));
			num += array2[0].Count;
			array = array.Concat(array2.SelectMany((Pending x) => x.Items)).Distinct().ToArray();
			text = array2[0].Group;
		}
		DateTimeOffset at = ((array2.Length != 0) ? array2.Min((Pending x) => x.At) : clock.Now);
		IReadOnlyList<string> readOnlyList = Split(text2, text);
		int num2 = array2.Sum((Pending x) => Encoding.UTF8.GetByteCount(x.Body));
		if (queue.Count - array2.Length + readOnlyList.Count > 512 || queuedBytes - num2 + ((IEnumerable<string>)readOnlyList).Sum((Func<string, int>)Encoding.UTF8.GetByteCount) > 10485760)
		{
			overflow += facts.Count;
			lastStatus = "待发容量已满；新明细未保留数已计入溢出，原有效待发保持";
			return;
		}
		Pending[] array3 = array2;
		foreach (Pending item in array3)
		{
			Remove(item);
		}
		for (int num4 = 0; num4 < readOnlyList.Count; num4++)
		{
			int byteCount = Encoding.UTF8.GetByteCount(readOnlyList[num4]);
			if (queue.Count >= 512 || queuedBytes + byteCount > 10485760)
			{
				overflow += facts.Count;
				lastStatus = "待发容量已满，未保留的明细已计入溢出数；请减少高频项目";
				break;
			}
			queue.Add(new Pending
			{
				Id = Guid.NewGuid().ToString("N"),
				Group = text,
				Target = target,
				Body = readOnlyList[num4],
				Items = array,
				Part = num4 + 1,
				Parts = readOnlyList.Count,
				Count = num,
				At = at,
				Epoch = epoch
			});
			queuedBytes += byteCount;
		}
	}

	internal async Task<TimeSpan> ProcessOnceAsync()
	{
		Pending pending;
		WecomTarget target;
		CancellationToken token;
		lock (gate)
		{
			if (disposed)
			{
				return TimeSpan.FromDays(1.0);
			}
			Dictionary<string, List<JsonObject>> dictionary = new Dictionary<string, List<JsonObject>>(StringComparer.Ordinal);
			foreach (Summary value2 in summaries.Values)
			{
				if (!(clock.Now >= value2.Next))
				{
					continue;
				}
				JsonObject jsonObject = selected[value2.Item];
				string text = value2.Next.ToUniversalTime().ToString("O");
				if (value2.LastSlot != text && identity != null)
				{
					value2.LastSlot = text;
					if (value2.Lost > 0)
					{
						lastStatus = "定时摘要含观察溢出缺口 " + value2.Lost;
					}
					if (WecomSettings.Text(WecomSettings.Items[value2.Item]["source"]?["event"]) == "push.self")
					{
						JsonObject raw = new JsonObject
						{
							["phase"] = "host-observed",
							["novelty"] = "unknown",
							["data"] = new JsonObject
							{
								["queued"] = queue.Count,
								["sent"] = sent,
								["failed"] = failed,
								["unknown"] = unknown,
								["cancelled"] = cancelledCount,
								["overflow"] = overflow
							}
						};
						value2.Facts.Add(SafeFact(raw, value2.Item, jsonObject));
					}
					if (!dictionary.TryGetValue(value2.Target, out var value))
					{
						value = (dictionary[value2.Target] = new List<JsonObject>());
					}
					value.AddRange(value2.Facts);
					value2.Facts.Clear();
					summaryBytes -= value2.Bytes;
					value2.Bytes = 0;
					value2.Lost = 0;
				}
				value2.Next = Next(jsonObject, (clock.Now > value2.Next) ? clock.Now : value2.Next);
			}
			foreach (KeyValuePair<string, List<JsonObject>> item in dictionary)
			{
				Enqueue(item.Key, item.Value);
			}
			pending = queue.FirstOrDefault((Pending x) => x.Earliest <= clock.Milliseconds);
			target = ((pending != null) ? targets.GetValueOrDefault(pending.Target) : null);
			if (pending == null)
			{
				return Delay();
			}
			if (target == null || pending.Epoch != epoch || clock.Now - pending.At > TimeSpan.FromHours(24.0))
			{
				Remove(pending);
				cancelledCount++;
				lastStatus = "待发已取消：接收目标、身份失效或超过24小时";
				return TimeSpan.Zero;
			}
			TimeSpan timeSpan = budget.Reserve(WecomStorage.ValidateWebhook(target.Webhook), clock.Milliseconds);
			if (timeSpan > TimeSpan.Zero)
			{
				pending.Earliest = clock.Milliseconds + (long)timeSpan.TotalMilliseconds;
				rateWait = timeSpan.TotalSeconds;
				return Delay();
			}
			pending.Attempts++;
			lastStatus = "发送中";
			rateWait = 0.0;
			token = scopeCancellation.Token;
		}
		using CancellationTokenSource attempt = CancellationTokenSource.CreateLinkedTokenSource(cancelled.Token, token);
		if (attempt.IsCancellationRequested)
		{
			return TimeSpan.Zero;
		}
		WecomReply wecomReply;
		try
		{
			wecomReply = await transport.SendAsync(WecomStorage.ValidateWebhook(target.Webhook), pending.Body, attempt.Token);
		}
		catch
		{
			wecomReply = new WecomReply("unknown", "发送组件未能确认结果；不会自动重发");
		}
		JsonObject entry = null;
		lock (gate)
		{
			if (disposed || pending.Epoch != epoch || !queue.Contains(pending))
			{
				return TimeSpan.Zero;
			}
			lastStatus = wecomReply.Reason;
			if (wecomReply.Limited)
			{
				budget.Limit(WecomStorage.ValidateWebhook(target.Webhook), clock.Milliseconds);
			}
			if (wecomReply.Retry && pending.Attempts <= WecomSettings.Number(config["network"]?["retries"], 2, 0, 3))
			{
				pending.Earliest = clock.Milliseconds + (wecomReply.Limited ? 60000 : Math.Min(30000, 2000 * pending.Attempts));
				return Delay();
			}
			Remove(pending);
			if (wecomReply.State == "success")
			{
				sent++;
			}
			else if (wecomReply.State == "unknown")
			{
				unknown++;
			}
			else if (wecomReply.State == "cancelled")
			{
				cancelledCount++;
			}
			else
			{
				failed++;
			}
			entry = new JsonObject
			{
				["id"] = pending.Id,
				["groupId"] = pending.Group,
				["part"] = pending.Part,
				["parts"] = pending.Parts,
				["at"] = pending.At.ToString("O"),
				["state"] = wecomReply.State,
				["targetName"] = target.Name,
				["body"] = pending.Body,
				["attempts"] = pending.Attempts,
				["reason"] = wecomReply.Reason,
				["count"] = pending.Count,
				["itemIds"] = new JsonArray(((IEnumerable<string>)pending.Items).Select((Func<string, JsonNode>)((string x) => JsonValue.Create(x))).ToArray())
			};
		}
		try
		{
			string text2 = await storage.AppendHistoryAsync(entry, config["history"].AsObject(), clock.Now);
			if (text2 != null)
			{
				storageWarning = text2;
			}
		}
		catch
		{
			storageWarning = "推送本地历史写入失败；游戏不受影响，未回退到其它目录";
		}
		lock (gate)
		{
			return Delay();
		}
	}

	private void Remove(Pending item)
	{
		if (queue.Remove(item))
		{
			queuedBytes -= Encoding.UTF8.GetByteCount(item.Body);
		}
	}

	private TimeSpan Delay()
	{
		double num = summaries.Values.Select((Summary x) => Math.Max(1.0, (x.Next - clock.Now).TotalMilliseconds)).DefaultIfEmpty(86400000.0).Min();
		if (queue.Count > 0)
		{
			num = Math.Min(num, Math.Max(0L, queue.Min((Pending x) => x.Earliest) - clock.Milliseconds));
		}
		return TimeSpan.FromMilliseconds(Math.Clamp(num, 0.0, 86400000.0));
	}

	private void Signal()
	{
		try
		{
			wake.Release();
		}
		catch (SemaphoreFullException)
		{
		}
		catch (ObjectDisposedException)
		{
		}
	}

	private async Task Loop()
	{
		_ = 1;
		try
		{
			while (!cancelled.IsCancellationRequested)
			{
				TimeSpan timeSpan;
				try
				{
					timeSpan = await ProcessOnceAsync();
				}
				catch
				{
					lastStatus = "推送处理失败，保留游戏正常运行";
					timeSpan = TimeSpan.FromSeconds(10.0);
				}
				if (timeSpan > TimeSpan.Zero)
				{
					await wake.WaitAsync(timeSpan, cancelled.Token);
				}
			}
		}
		catch (OperationCanceledException)
		{
		}
	}

	internal JsonObject Status()
	{
		lock (gate)
		{
			return new JsonObject
			{
				["active"] = !disposed,
				["selectedItems"] = selected.Count,
				["queue"] = queue.Count,
				["queuedBytes"] = queuedBytes,
				["lastStatus"] = lastStatus,
				["sent"] = sent,
				["failed"] = failed,
				["unknown"] = unknown,
				["cancelled"] = cancelledCount,
				["overflow"] = overflow,
				["rateWaitSeconds"] = rateWait,
				["nextScheduledAt"] = ((summaries.Values.Count > 0) ? summaries.Values.Min((Summary x) => x.Next).ToString("O") : null),
				["storageWarning"] = storageWarning,
				["summaryBytes"] = summaryBytes,
				["textOnly"] = true,
				["queuePersistence"] = false
			};
		}
	}

	internal void ClearQueue()
	{
		lock (gate)
		{
			scopeCancellation.Cancel();
			scopeCancellation.Dispose();
			scopeCancellation = new CancellationTokenSource();
			cancelledCount += queue.Count;
			queue.Clear();
			queuedBytes = (summaryBytes = 0);
			foreach (Summary value in summaries.Values)
			{
				value.Facts.Clear();
				value.Lost = (value.Bytes = 0);
			}
			lastStatus = "已清空待发；去重游标和历史未清除";
			epoch++;
		}
		Signal();
	}

	public void Dispose()
	{
		lock (gate)
		{
			if (disposed)
			{
				return;
			}
			disposed = true;
			epoch++;
			cancelledCount += queue.Count;
			queue.Clear();
			summaries.Clear();
			seen.Clear();
			seenOrder.Clear();
			queuedBytes = (summaryBytes = 0);
		}
		cancelled.Cancel();
		scopeCancellation.Cancel();
		transport.Dispose();
		Signal();
	}

	internal static async Task<JsonObject> TestAsync(WecomTarget target, JsonObject config, WecomStorage storage, IWecomTransport? transport = null, IWecomClock? clock = null, WecomRateBudget? budget = null, CancellationToken token = default(CancellationToken))
	{
		if (token.IsCancellationRequested)
		{
			return new JsonObject
			{
				["state"] = "cancelled",
				["reason"] = "目标或配置已变化，测试请求未提交"
			};
		}
		if (clock == null)
		{
			clock = new WecomClock();
		}
		if (budget == null)
		{
			budget = WecomRateBudget.Shared;
		}
		Uri address = WecomStorage.ValidateWebhook(target.Webhook);
		TimeSpan timeSpan = budget.Reserve(address, clock.Milliseconds);
		if (timeSpan > TimeSpan.Zero)
		{
			return new JsonObject
			{
				["state"] = "failed",
				["reason"] = "本机分钟预算已满，本次测试未提交；测试共用20条/分钟预算，请稍后再试",
				["rateWaitSeconds"] = Math.Ceiling(timeSpan.TotalSeconds)
			};
		}
		using IWecomTransport sender = transport ?? new WecomHttpTransport(config["network"].AsObject());
		WecomReply wecomReply;
		try
		{
			wecomReply = await sender.SendAsync(address, "PokéBonk 旅伴 · 企微测试通知\n此消息用于确认群接口。接口成功不代表手机弹窗、响铃或已读。", token);
		}
		catch
		{
			wecomReply = new WecomReply("unknown", "测试发送组件未能确认结果；不会自动重发");
		}
		if (token.IsCancellationRequested)
		{
			return new JsonObject
			{
				["state"] = "cancelled",
				["reason"] = "配置或目标已变化，旧测试结果未采纳；已提交请求可能已经收到"
			};
		}
		if (wecomReply.Limited)
		{
			budget.Limit(address, clock.Milliseconds);
		}
		JsonObject entry = new JsonObject
		{
			["id"] = Guid.NewGuid().ToString("N"),
			["at"] = clock.Now.ToString("O"),
			["state"] = wecomReply.State,
			["targetName"] = target.Name,
			["attempts"] = 1,
			["reason"] = wecomReply.Reason,
			["count"] = 1,
			["body"] = "企微测试通知（固定正文）"
		};
		try
		{
			await storage.AppendHistoryAsync(entry, config["history"].AsObject(), clock.Now);
		}
		catch
		{
			entry["storageWarning"] = "本地历史无法写入，未影响游戏";
		}
		entry.Remove("body");
		return entry;
	}
}
