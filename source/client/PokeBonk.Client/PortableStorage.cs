using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace PokeBonk.Client;

public sealed class PortableStorage
{
	private static readonly UTF8Encoding Utf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

	private readonly object journalLock = new object();

	private readonly StringComparison comparison = (OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);

	public string RootDirectory { get; }

	public string DataDirectory { get; }

	public string BrowserDirectory { get; }

	public string UiDirectory { get; }

	public string TemporaryDirectory { get; }

	public string SettingsPath { get; }

	public string StatusPath { get; }

	public string JournalPath { get; }

	public string ReadableLogPath { get; }

	public PortableStorage(string? executableDirectory = null, string? profile = null)
	{
		RootDirectory = Path.TrimEndingDirectorySeparator(Path.GetFullPath(executableDirectory ?? AppContext.BaseDirectory));
		if (profile != null && !Regex.IsMatch(profile, "^[a-zA-Z0-9][a-zA-Z0-9-]{0,31}$"))
		{
			throw new IOException("客户端数据分区名称无效。");
		}
		DataDirectory = Path.Combine(RootDirectory, "data", profile ?? "");
		BrowserDirectory = Path.Combine(DataDirectory, "browser");
		UiDirectory = Path.Combine(DataDirectory, "ui");
		TemporaryDirectory = Path.Combine(DataDirectory, "temp");
		SettingsPath = Path.Combine(DataDirectory, "settings.json");
		StatusPath = Path.Combine(DataDirectory, "status.json");
		JournalPath = Path.Combine(DataDirectory, "journal.jsonl");
		ReadableLogPath = Path.Combine(RootDirectory, (profile == null) ? "挂机日志.txt" : ("挂机日志-" + profile + ".txt"));
		try
		{
			string[] array = new string[5] { RootDirectory, DataDirectory, BrowserDirectory, UiDirectory, TemporaryDirectory };
			foreach (string path in array)
			{
				EnsureDirectory(path);
			}
			using (OpenWritable(JournalPath))
			{
				using (OpenWritable(ReadableLogPath))
				{
					string path2 = DataPath(Path.Combine("temp", ".write-check-" + Guid.NewGuid().ToString("N")));
					try
					{
						using FileStream fileStream = new FileStream(path2, FileMode.CreateNew, FileAccess.Write, FileShare.None);
						ValidatePath(path2);
						fileStream.WriteByte(0);
						fileStream.Flush(flushToDisk: true);
					}
					finally
					{
						if (File.Exists(path2))
						{
							ValidatePath(path2);
							File.Delete(path2);
						}
					}
				}
			}
		}
		catch (Exception ex) when (((ex is IOException || ex is UnauthorizedAccessException || ex is SecurityException) ? 1 : 0) != 0)
		{
			throw StorageFailure(ex);
		}
	}

	public string RootPath(string relativePath)
	{
		return ResolveRelative(RootDirectory, relativePath);
	}

	public string DataPath(string relativePath)
	{
		return ResolveRelative(DataDirectory, relativePath);
	}

	private string ResolveRelative(string directory, string relativePath)
	{
		if (string.IsNullOrWhiteSpace(relativePath) || Path.IsPathRooted(relativePath))
		{
			throw new IOException("客户端文件路径必须是数据目录内的相对路径。");
		}
		string fullPath = Path.GetFullPath(Path.Combine(directory, relativePath));
		ValidatePath(fullPath);
		string text = Path.TrimEndingDirectorySeparator(directory);
		string value = (Path.EndsInDirectorySeparator(text) ? text : (text + Path.DirectorySeparatorChar));
		if (!fullPath.Equals(text, comparison) && !fullPath.StartsWith(value, comparison))
		{
			throw new IOException("客户端文件路径超出指定数据目录：" + fullPath);
		}
		return fullPath;
	}

	public string ValidatePath(string path)
	{
		return ValidatePathInRoot(RootDirectory, path);
	}

	internal static string ValidatePathInRoot(string rootDirectory, string path)
	{
		string text = Path.TrimEndingDirectorySeparator(Path.GetFullPath(rootDirectory));
		StringComparison comparisonType = (OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
		if (!Path.IsPathFullyQualified(path))
		{
			throw new IOException("客户端文件路径不是完整路径。");
		}
		string fullPath = Path.GetFullPath(path);
		string value = (Path.EndsInDirectorySeparator(text) ? text : (text + Path.DirectorySeparatorChar));
		if (!fullPath.Equals(text, comparisonType) && !fullPath.StartsWith(value, comparisonType))
		{
			throw new IOException("客户端文件路径超出程序目录：" + fullPath);
		}
		string text2 = Path.GetPathRoot(fullPath) ?? throw new IOException("无法确定客户端数据所在目录。");
		string text3 = fullPath.Substring(text2.Length);
		if (OperatingSystem.IsWindows() && text3.Contains(':'))
		{
			throw new IOException("客户端数据路径不能使用备用数据流。");
		}
		string text4 = text2;
		foreach (string item in text3.Split(new char[2]
		{
			Path.DirectorySeparatorChar,
			Path.AltDirectorySeparatorChar
		}, StringSplitOptions.RemoveEmptyEntries).Prepend(""))
		{
			if (item.Length > 0)
			{
				text4 = Path.Combine(text4, item);
			}
			FileAttributes attributes;
			try
			{
				attributes = File.GetAttributes(text4);
			}
			catch (FileNotFoundException)
			{
				break;
			}
			catch (DirectoryNotFoundException)
			{
				break;
			}
			if ((attributes & FileAttributes.ReparsePoint) != FileAttributes.None)
			{
				throw new IOException("客户端数据路径包含符号链接或目录联接，已拒绝写入：" + text4);
			}
		}
		return fullPath;
	}

	public string EnsureDirectory(string path)
	{
		string path2 = ValidatePath(path);
		Directory.CreateDirectory(path2);
		return ValidatePath(path2);
	}

	public void ConfigureProcessEnvironment()
	{
		EnsureDirectory(TemporaryDirectory);
		EnsureDirectory(BrowserDirectory);
		Environment.SetEnvironmentVariable("TEMP", TemporaryDirectory, EnvironmentVariableTarget.Process);
		Environment.SetEnvironmentVariable("TMP", TemporaryDirectory, EnvironmentVariableTarget.Process);
		Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", BrowserDirectory, EnvironmentVariableTarget.Process);
	}

	internal void RequireBrowserDirectory(string actualDirectory)
	{
		string text = Path.TrimEndingDirectorySeparator(ValidatePath(actualDirectory));
		string value = Path.TrimEndingDirectorySeparator(ValidatePath(BrowserDirectory));
		if (!text.Equals(value, comparison))
		{
			throw new IOException("浏览器数据目录与当前客户端不一致，已停止初始化，未复用其它登录资料。");
		}
	}

	private FileStream OpenWritable(string path)
	{
		ValidatePath(path);
		FileStream fileStream = new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.Read);
		try
		{
			ValidatePath(path);
			return fileStream;
		}
		catch
		{
			fileStream.Dispose();
			throw;
		}
	}

	internal async Task WriteSettingsAtomicAsync(string settings)
	{
		string target = ValidatePath(SettingsPath);
		string pending = ValidatePath(target + ".pending-" + Guid.NewGuid().ToString("N"));
		try
		{
			using (FileStream output = new FileStream(pending, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.Asynchronous))
			{
				await output.WriteAsync(Utf8.GetBytes(settings));
				await output.FlushAsync();
				output.Flush(flushToDisk: true);
			}
			File.Move(ValidatePath(pending), ValidatePath(target), overwrite: true);
		}
		finally
		{
			if (File.Exists(pending))
			{
				File.Delete(ValidatePath(pending));
			}
		}
	}

	private IOException StorageFailure(Exception error)
	{
		return new IOException("无法写入客户端目录：" + RootDirectory + "。请将完整客户端放到可写文件夹后重试。" + error.Message, error);
	}

	private static JsonObject NormalizeEntry(JsonObject entry)
	{
		JsonObject jsonObject = entry.DeepClone().AsObject();
		DateTimeOffset result;
		DateTimeOffset dateTimeOffset = (DateTimeOffset.TryParse(jsonObject["at"]?.ToString() ?? jsonObject["time"]?.ToString(), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out result) ? result : DateTimeOffset.Now);
		string text = jsonObject["level"]?.ToString() ?? jsonObject["type"]?.ToString() ?? "info";
		string text2 = jsonObject["title"]?.ToString() ?? jsonObject["message"]?.ToString() ?? "记录";
		string text3 = jsonObject["detail"]?.ToString() ?? "";
		jsonObject["at"] = dateTimeOffset.ToString("O");
		JsonObject jsonObject2 = jsonObject;
		if (jsonObject2["time"] == null)
		{
			JsonNode jsonNode = (jsonObject2["time"] = dateTimeOffset.ToString("O"));
		}
		jsonObject["level"] = text;
		jsonObject["title"] = text2;
		jsonObject["detail"] = text3;
		return jsonObject;
	}

	private static string ReadableEntry(JsonObject copy)
	{
		DateTimeOffset dateTimeOffset = DateTimeOffset.Parse(copy["at"].ToString(), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
		string text = copy["level"].ToString();
		string text2 = copy["title"].ToString();
		string text3 = copy["detail"].ToString();
		string text4;
		switch (text.ToLowerInvariant())
		{
		case "error":
			text4 = "错误";
			break;
		case "warning":
		case "warn":
			text4 = "警告";
			break;
		case "debug":
			text4 = "调试";
			break;
		case "info":
			text4 = "信息";
			break;
		default:
			text4 = text;
			break;
		}
		string value = text4;
		string value2 = text2.Replace('\r', ' ').Replace('\n', ' ');
		string text5 = text3.Replace("\r\n", "\n").Replace('\r', '\n').Replace("\n", Environment.NewLine + "  ");
		return $"[{dateTimeOffset.ToString("yyyy-MM-dd HH:mm:ss zzz", CultureInfo.InvariantCulture)}] [{value}] {value2}{Environment.NewLine}  详情：{((text5.Length == 0) ? "无" : text5)}{Environment.NewLine}{Environment.NewLine}";
	}

	public void Append(JsonObject entry)
	{
		ArgumentNullException.ThrowIfNull(entry, "entry");
		JsonObject jsonObject = NormalizeEntry(entry);
		byte[] bytes = Utf8.GetBytes(jsonObject.ToJsonString() + "\n");
		byte[] bytes2 = Utf8.GetBytes(ReadableEntry(jsonObject));
		lock (journalLock)
		{
			try
			{
				using FileStream fileStream = OpenWritable(JournalPath);
				using FileStream fileStream2 = OpenWritable(ReadableLogPath);
				long length = fileStream.Length;
				long length2 = fileStream2.Length;
				try
				{
					fileStream.Position = length;
					fileStream2.Position = length2;
					ValidatePath(JournalPath);
					ValidatePath(ReadableLogPath);
					fileStream.Write(bytes);
					fileStream2.Write(bytes2);
					fileStream.Flush(flushToDisk: true);
					fileStream2.Flush(flushToDisk: true);
				}
				catch
				{
					try
					{
						fileStream.SetLength(length);
						fileStream.Flush(flushToDisk: true);
					}
					catch
					{
					}
					try
					{
						fileStream2.SetLength(length2);
						fileStream2.Flush(flushToDisk: true);
					}
					catch
					{
					}
					throw;
				}
			}
			catch (Exception ex) when (((ex is IOException || ex is UnauthorizedAccessException || ex is SecurityException) ? 1 : 0) != 0)
			{
				throw StorageFailure(ex);
			}
		}
	}

	public void RewriteEntries(IEnumerable<JsonObject> entries)
	{
		ArgumentNullException.ThrowIfNull(entries, "entries");
		lock (journalLock)
		{
			string text = Guid.NewGuid().ToString("N");
			string text2 = DataPath(Path.Combine("temp", "journal-" + text + ".stage"));
			string text3 = DataPath(Path.Combine("temp", "readable-" + text + ".stage"));
			string text4 = DataPath(Path.Combine("temp", "journal-" + text + ".backup"));
			string text5 = DataPath(Path.Combine("temp", "readable-" + text + ".backup"));
			bool flag = false;
			try
			{
				using (FileStream fileStream = new FileStream(ValidatePath(text2), FileMode.CreateNew, FileAccess.Write, FileShare.None))
				{
					using FileStream fileStream2 = new FileStream(ValidatePath(text3), FileMode.CreateNew, FileAccess.Write, FileShare.None);
					foreach (JsonObject entry in entries)
					{
						JsonObject jsonObject = NormalizeEntry(entry);
						fileStream.Write(Utf8.GetBytes(jsonObject.ToJsonString() + "\n"));
						fileStream2.Write(Utf8.GetBytes(ReadableEntry(jsonObject)));
					}
					fileStream.Flush(flushToDisk: true);
					fileStream2.Flush(flushToDisk: true);
				}
				File.Copy(ValidatePath(JournalPath), ValidatePath(text4), overwrite: false);
				File.Copy(ValidatePath(ReadableLogPath), ValidatePath(text5), overwrite: false);
				try
				{
					File.Move(ValidatePath(text2), ValidatePath(JournalPath), overwrite: true);
					File.Move(ValidatePath(text3), ValidatePath(ReadableLogPath), overwrite: true);
					flag = true;
				}
				catch
				{
					File.Copy(ValidatePath(text4), ValidatePath(JournalPath), overwrite: true);
					File.Copy(ValidatePath(text5), ValidatePath(ReadableLogPath), overwrite: true);
					throw;
				}
			}
			catch (Exception ex) when (((ex is IOException || ex is UnauthorizedAccessException || ex is SecurityException) ? 1 : 0) != 0)
			{
				throw StorageFailure(ex);
			}
			finally
			{
				string[] array = new string[2] { text2, text3 };
				foreach (string path in array)
				{
					if (File.Exists(path))
					{
						File.Delete(ValidatePath(path));
					}
				}
				if (flag)
				{
					array = new string[2] { text4, text5 };
					foreach (string path2 in array)
					{
						if (File.Exists(path2))
						{
							File.Delete(ValidatePath(path2));
						}
					}
				}
			}
		}
	}

	private static IEnumerable<JsonObject> JournalEntries(StreamReader reader)
	{
		while (true)
		{
			string text = reader.ReadLine();
			if (text == null)
			{
				break;
			}
			if (!string.IsNullOrWhiteSpace(text))
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

	public IReadOnlyList<JsonObject> ReadSelectedEntries(Func<IEnumerable<JsonObject>, IReadOnlyList<JsonObject>> select)
	{
		ArgumentNullException.ThrowIfNull(select, "select");
		lock (journalLock)
		{
			try
			{
				using FileStream stream = new FileStream(ValidatePath(JournalPath), FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
				ValidatePath(JournalPath);
				using StreamReader reader = new StreamReader(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: false));
				return select(JournalEntries(reader));
			}
			catch (Exception ex) when (((ex is IOException || ex is UnauthorizedAccessException || ex is SecurityException) ? 1 : 0) != 0)
			{
				throw StorageFailure(ex);
			}
		}
	}

	public void Clear()
	{
		lock (journalLock)
		{
			try
			{
				using FileStream fileStream = OpenWritable(JournalPath);
				using FileStream fileStream2 = OpenWritable(ReadableLogPath);
				ValidatePath(JournalPath);
				ValidatePath(ReadableLogPath);
				fileStream.SetLength(0L);
				fileStream2.SetLength(0L);
				fileStream.Flush(flushToDisk: true);
				fileStream2.Flush(flushToDisk: true);
			}
			catch (Exception ex) when (((ex is IOException || ex is UnauthorizedAccessException || ex is SecurityException) ? 1 : 0) != 0)
			{
				throw StorageFailure(ex);
			}
		}
	}

	public IReadOnlyList<JsonObject> ReadEntries(int limit = 2000)
	{
		if (limit < 0)
		{
			throw new ArgumentOutOfRangeException("limit");
		}
		lock (journalLock)
		{
			try
			{
				ValidatePath(JournalPath);
				using FileStream stream = new FileStream(JournalPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
				ValidatePath(JournalPath);
				using StreamReader streamReader = new StreamReader(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: false));
				Queue<JsonObject> queue = new Queue<JsonObject>();
				while (true)
				{
					string text = streamReader.ReadLine();
					if (text == null)
					{
						break;
					}
					if (string.IsNullOrWhiteSpace(text) || limit == 0)
					{
						continue;
					}
					try
					{
						if (JsonNode.Parse(text) is JsonObject item)
						{
							queue.Enqueue(item);
							if (queue.Count > limit)
							{
								queue.Dequeue();
							}
						}
					}
					catch (JsonException)
					{
					}
				}
				return queue.ToArray();
			}
			catch (Exception ex2) when (((ex2 is IOException || ex2 is UnauthorizedAccessException || ex2 is SecurityException) ? 1 : 0) != 0)
			{
				throw StorageFailure(ex2);
			}
		}
	}
}
