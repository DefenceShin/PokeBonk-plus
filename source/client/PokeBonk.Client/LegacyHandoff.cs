using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Security;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace PokeBonk.Client;

internal static class LegacyHandoff
{
	private static readonly SemaphoreSlim Gate = new SemaphoreSlim(1, 1);

	private static readonly UTF8Encoding Utf8WithoutBom = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

	private static readonly TimeSpan MaximumStatusAge = TimeSpan.FromSeconds(20.0);

	private static readonly TimeSpan ExitTimeout = TimeSpan.FromSeconds(15.0);

	public static async Task<bool> TryCompleteAsync(string dataRoot, string? accountId, Action<string> progress, Action<string>? validateWritePath = null)
	{
		if (string.IsNullOrWhiteSpace(accountId) || string.IsNullOrWhiteSpace(dataRoot))
		{
			return false;
		}
		await Gate.WaitAsync();
		try
		{
			string markerPath;
			string markerText;
			int pid;
			string controlPath;
			DateTimeOffset result;
			try
			{
				markerPath = Path.Combine(Path.GetFullPath(dataRoot), "legacy-runner.json");
				validateWritePath?.Invoke(markerPath);
				if (!File.Exists(markerPath) || IsReparsePoint(markerPath))
				{
					return false;
				}
				markerText = await File.ReadAllTextAsync(markerPath, Encoding.UTF8);
				using JsonDocument marker = JsonDocument.Parse(markerText);
				JsonElement rootElement = marker.RootElement;
				if (!string.Equals(ReadString(rootElement, "accountId"), accountId, StringComparison.Ordinal))
				{
					return false;
				}
				if (!rootElement.TryGetProperty("pid", out var value) || value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out pid) || pid <= 0)
				{
					return false;
				}
				string text = ReadString(rootElement, "controlPath");
				string text2 = ReadString(rootElement, "statusPath");
				if (string.IsNullOrWhiteSpace(text) || string.IsNullOrWhiteSpace(text2) || !Path.IsPathFullyQualified(text) || !Path.IsPathFullyQualified(text2))
				{
					return false;
				}
				controlPath = Path.GetFullPath(text);
				string statusPath = Path.GetFullPath(text2);
				validateWritePath?.Invoke(markerPath);
				validateWritePath?.Invoke(controlPath);
				validateWritePath?.Invoke(statusPath);
				if (!string.Equals(Path.GetFileName(controlPath), "control.json", StringComparison.OrdinalIgnoreCase) || !string.Equals(Path.GetFileName(statusPath), "status.json", StringComparison.OrdinalIgnoreCase))
				{
					return false;
				}
				string directoryName = Path.GetDirectoryName(controlPath);
				string directoryName2 = Path.GetDirectoryName(statusPath);
				if (string.IsNullOrEmpty(directoryName) || string.IsNullOrEmpty(directoryName2) || !string.Equals(directoryName, directoryName2, StringComparison.OrdinalIgnoreCase) || !string.Equals(Path.GetFileName(directoryName), "artifacts", StringComparison.OrdinalIgnoreCase) || !Directory.Exists(directoryName) || IsReparsePoint(directoryName))
				{
					return false;
				}
				string directoryName3 = Path.GetDirectoryName(directoryName);
				if (string.IsNullOrEmpty(directoryName3))
				{
					return false;
				}
				string path = Path.Combine(directoryName3, "package.json");
				if (!File.Exists(path) || IsReparsePoint(path) || !File.Exists(statusPath) || IsReparsePoint(statusPath) || (File.Exists(controlPath) && IsReparsePoint(controlPath)))
				{
					return false;
				}
				using JsonDocument package = JsonDocument.Parse(await File.ReadAllTextAsync(path, Encoding.UTF8));
				if (!string.Equals(ReadString(package.RootElement, "name"), "pokebonk-autopilot", StringComparison.Ordinal))
				{
					return false;
				}
				using JsonDocument jsonDocument = await ReadStatusWithRetryAsync(statusPath);
				if (!string.Equals(ReadString(jsonDocument.RootElement, "accountId"), accountId, StringComparison.Ordinal))
				{
					return false;
				}
				if (!DateTimeOffset.TryParse(ReadString(jsonDocument.RootElement, "at"), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out result))
				{
					return false;
				}
				TimeSpan timeSpan = DateTimeOffset.UtcNow - result.ToUniversalTime();
				if (timeSpan < TimeSpan.Zero || timeSpan > MaximumStatusAge)
				{
					return false;
				}
			}
			catch (Exception exception) when (IsValidationFailure(exception))
			{
				return false;
			}
			Process runner;
			try
			{
				runner = Process.GetProcessById(pid);
			}
			catch (ArgumentException)
			{
				return false;
			}
			using (runner)
			{
				try
				{
					if (runner.HasExited || !string.Equals(runner.ProcessName, "node", StringComparison.OrdinalIgnoreCase))
					{
						return false;
					}
					if (runner.StartTime.ToUniversalTime() > result.UtcDateTime)
					{
						return false;
					}
				}
				catch (Exception ex2) when (((ex2 is InvalidOperationException || ex2 is Win32Exception || ex2 is NotSupportedException) ? 1 : 0) != 0)
				{
					return false;
				}
				progress("检测到同账号的旧版脚本，正在请求正常结算保存；保存完成后自动接管，请保持窗口开启。");
				try
				{
					validateWritePath?.Invoke(controlPath);
					await File.WriteAllTextAsync(controlPath, "{\"action\":\"stop\"}", Utf8WithoutBom);
				}
				catch (Exception ex3) when (IsValidationFailure(ex3))
				{
					throw new InvalidOperationException("无法向旧版脚本发送保存退出请求。客户端没有开始新局，请检查旧版脚本状态后重试。", ex3);
				}
				Stopwatch wait = Stopwatch.StartNew();
				try
				{
					while (!runner.HasExited)
					{
						TimeSpan timeSpan2 = ExitTimeout - wait.Elapsed;
						if (timeSpan2 <= TimeSpan.Zero)
						{
							throw new TimeoutException("旧版脚本在 15 秒内尚未退出，可能仍在保存。客户端没有开始新局；请等待旧版正常退出后重试。");
						}
						await Task.Delay((timeSpan2 < TimeSpan.FromMilliseconds(250.0)) ? timeSpan2 : TimeSpan.FromMilliseconds(250.0));
					}
				}
				catch (Exception ex4) when (((ex4 is Win32Exception || ex4 is InvalidOperationException) ? 1 : 0) != 0)
				{
					throw new InvalidOperationException("无法确认旧版脚本是否已保存退出。客户端没有开始新局，请确认旧版状态后重试。", ex4);
				}
				try
				{
					if (File.Exists(markerPath))
					{
						if (!string.Equals(await File.ReadAllTextAsync(markerPath, Encoding.UTF8), markerText, StringComparison.Ordinal))
						{
							throw new InvalidOperationException("交接期间旧版脚本标记发生变化，客户端没有开始新局。请确认仅保留一个挂机实例后重试。");
						}
						validateWritePath?.Invoke(markerPath);
						File.Delete(markerPath);
					}
				}
				catch (Exception ex5) when (IsValidationFailure(ex5))
				{
					throw new InvalidOperationException("旧版脚本已退出，但交接标记未能清理。客户端没有开始新局，请检查本机数据目录后重试。", ex5);
				}
				progress("旧版脚本已正常退出，交接完成，正在同步保存后的账号进度。");
				return true;
			}
		}
		finally
		{
			Gate.Release();
		}
	}

	private static string? ReadString(JsonElement element, string property)
	{
		if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(property, out var value) || value.ValueKind != JsonValueKind.String)
		{
			return null;
		}
		return value.GetString();
	}

	private static bool IsReparsePoint(string path)
	{
		return (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0;
	}

	private static async Task<JsonDocument> ReadStatusWithRetryAsync(string statusPath)
	{
		int retry = 0;
		while (true)
		{
			try
			{
				return JsonDocument.Parse(await File.ReadAllTextAsync(statusPath, Encoding.UTF8));
			}
			catch (Exception ex) when (((ex is IOException || ex is JsonException) ? 1 : 0) != 0)
			{
				if (retry >= 3)
				{
					throw new InvalidOperationException("旧脚本状态尚未同步，请稍候重试。客户端没有开始新局。", ex);
				}
				await Task.Delay(250);
			}
			retry++;
		}
	}

	private static bool IsValidationFailure(Exception exception)
	{
		if (exception is IOException || exception is UnauthorizedAccessException || exception is JsonException || exception is ArgumentException || exception is NotSupportedException || exception is SecurityException)
		{
			return true;
		}
		return false;
	}
}
