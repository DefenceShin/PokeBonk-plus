using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PokeBonk.Client;

internal sealed class BrowserOptimizationPolicy(PortableStorage storage)
{
	internal string PreferencePath => storage.DataPath("browser-optimization.json");

	internal bool Enabled { get; private set; }

	internal bool PreventAutomaticSleep { get; private set; }

	internal bool ShouldOfferAtLaunch => !Enabled;

	internal string? ReadWarning { get; private set; }

	internal bool Load()
	{
		Enabled = false;
		PreventAutomaticSleep = false;
		ReadWarning = null;
		string text = storage.ValidatePath(PreferencePath);
		if (!File.Exists(text))
		{
			return false;
		}
		try
		{
			if (new FileInfo(text).Length > 4096)
			{
				throw new InvalidDataException("浏览器优化设置文件过大");
			}
			JsonNode jsonNode = JsonNode.Parse(File.ReadAllText(storage.ValidatePath(text), Encoding.UTF8));
			int? num = jsonNode?["schemaVersion"]?.GetValue<int>();
			bool flag;
			if (num.HasValue)
			{
				int valueOrDefault = num.GetValueOrDefault();
				if ((uint)(valueOrDefault - 1) <= 1u)
				{
					flag = true;
					goto IL_00d6;
				}
			}
			flag = false;
			goto IL_00d6;
			IL_00d6:
			if (!flag || !(jsonNode?["enabled"] is JsonValue jsonValue) || !jsonValue.TryGetValue<bool>(out var value))
			{
				throw new InvalidDataException("浏览器优化设置格式无效");
			}
			if (num == 2)
			{
				if (!(jsonNode?["preventAutomaticSleep"] is JsonValue jsonValue2) || !jsonValue2.TryGetValue<bool>(out var value2))
				{
					throw new InvalidDataException("浏览器优化设置格式无效");
				}
				PreventAutomaticSleep = value && value2;
			}
			return Enabled = value;
		}
		catch (Exception ex) when (((ex is JsonException || ex is InvalidOperationException || ex is FormatException || ex is IOException || ex is InvalidDataException || ex is UnauthorizedAccessException) ? 1 : 0) != 0)
		{
			ReadWarning = "浏览器优化设置未能读取，使用原设置；未删除原文件。";
			return false;
		}
	}

	internal void Enable(bool confirmed)
	{
		if (!confirmed)
		{
			throw new InvalidOperationException("请先阅读并确认浏览器优化的具体改动。");
		}
		string path = storage.ValidatePath(PreferencePath);
		string path2 = storage.DataPath("temp/browser-optimization-" + Guid.NewGuid().ToString("N") + ".pending");
		try
		{
			string s = new JsonObject
			{
				["schemaVersion"] = 2,
				["enabled"] = true,
				["preventAutomaticSleep"] = true
			}.ToJsonString();
			using (FileStream fileStream = new FileStream(storage.ValidatePath(path2), FileMode.CreateNew, FileAccess.Write, FileShare.None))
			{
				fileStream.Write(Encoding.UTF8.GetBytes(s));
				fileStream.Flush(flushToDisk: true);
			}
			File.Move(storage.ValidatePath(path2), storage.ValidatePath(path), overwrite: true);
			Enabled = true;
			PreventAutomaticSleep = true;
			ReadWarning = null;
		}
		finally
		{
			if (File.Exists(path2))
			{
				File.Delete(storage.ValidatePath(path2));
			}
		}
	}

	internal static string BrowserArguments(string cachePath, bool enabled, bool diagnostics, int diagnosticPort = 0)
	{
		if (cachePath.IndexOfAny(new char[4] { '"', '\r', '\n', '\0' }) >= 0)
		{
			throw new IOException("浏览器缓存路径无效。");
		}
		string text = "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";
		if (!enabled)
		{
			text += " --disable-gpu-shader-disk-cache";
		}
		text = text + " --disk-cache-dir=\"" + cachePath + "\"";
		if (diagnostics)
		{
			if (diagnosticPort != 0)
			{
				throw new ArgumentOutOfRangeException("diagnosticPort", "诊断端口由本客户端自动分配。");
			}
			text = text + " --remote-debugging-port=" + diagnosticPort + " --remote-debugging-address=127.0.0.1";
		}
		return text;
	}
}
