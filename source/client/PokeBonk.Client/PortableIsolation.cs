using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace PokeBonk.Client;

internal static class PortableIsolation
{
	private struct FileId
	{
		internal ulong Volume;

		internal ulong Low;

		internal ulong High;
	}

	private const string BindingName = ".client-root.json";

	private const string JournalName = ".client-root-transaction.json";

	private static readonly UTF8Encoding Utf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

	private static readonly Regex Token = new Regex("^[a-f0-9]{32}$", RegexOptions.CultureInvariant);

	private static readonly Regex LogName = new Regex("^挂机日志(?:-[A-Za-z0-9-]{1,32})?\\.txt$", RegexOptions.CultureInvariant);

	[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
	private static extern SafeFileHandle CreateFileW(string name, uint access, uint share, nint security, uint creation, uint flags, nint template);

	[DllImport("kernel32.dll", SetLastError = true)]
	private static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int kind, out FileId info, uint size);

	internal static SafeFileHandle OpenDirectory(string root)
	{
		PortableStorage.ValidatePathInRoot(root, root);
		if (!OperatingSystem.IsWindows())
		{
			throw new IOException("当前系统无法核验Windows客户端目录身份，未启动浏览器。");
		}
		SafeFileHandle safeFileHandle = CreateFileW(root, 0u, 3u, IntPtr.Zero, 3u, 33554432u, IntPtr.Zero);
		if (safeFileHandle.IsInvalid)
		{
			safeFileHandle.Dispose();
			throw new IOException("无法打开客户端目录身份。", new Win32Exception(Marshal.GetLastWin32Error()));
		}
		return safeFileHandle;
	}

	internal static string DirectoryIdentity(string root)
	{
		using SafeFileHandle handle = OpenDirectory(root);
		if (!GetFileInformationByHandleEx(handle, 18, out var info, 24u) || (info.Low == 0L && info.High == 0L))
		{
			throw new IOException("当前文件系统无法可靠核验客户端目录身份，未读取或复用旧登录。", new Win32Exception(Marshal.GetLastWin32Error()));
		}
		return $"{info.Volume:X16}:{info.High:X16}{info.Low:X16}";
	}

	private static string P(string root, string relative)
	{
		return PortableStorage.ValidatePathInRoot(root, Path.Combine(root, relative));
	}

	private static JsonObject? Read(string path, long max = 32768L)
	{
		if (!File.Exists(path))
		{
			return null;
		}
		if (new FileInfo(path).Length > max)
		{
			throw new IOException("客户端目录标识文件过大，未启动浏览器。");
		}
		return (JsonNode.Parse(File.ReadAllText(path, Utf8)) as JsonObject) ?? throw new IOException("客户端目录标识格式无效。");
	}

	private static string Text(JsonNode? value)
	{
		if (value == null || value.GetValueKind() != JsonValueKind.String)
		{
			return "";
		}
		return value.GetValue<string>();
	}

	private static bool Yes(JsonNode? value)
	{
		if (value == null)
		{
			return false;
		}
		return value.GetValueKind() == JsonValueKind.True;
	}

	private static bool ValidBinding(JsonObject? value)
	{
		if (value?["schemaVersion"] is JsonValue jsonValue && jsonValue.TryGetValue<int>(out var value2) && value2 == 1 && Token.IsMatch(Text(value["installationId"])))
		{
			return Regex.IsMatch(Text(value["rootIdentity"]), "^[A-F0-9]{16}:[A-F0-9]{32}$", RegexOptions.CultureInvariant);
		}
		return false;
	}

	private static void Atomic(string root, string relative, string text)
	{
		P(root, relative);
		string path = P(root, relative + ".pending-" + Guid.NewGuid().ToString("N"));
		try
		{
			using (FileStream fileStream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
			{
				fileStream.Write(Utf8.GetBytes(text));
				fileStream.Flush(flushToDisk: true);
			}
			File.Move(P(root, Path.GetRelativePath(root, path)), P(root, relative), overwrite: true);
		}
		finally
		{
			if (File.Exists(path))
			{
				File.Delete(P(root, Path.GetRelativePath(root, path)));
			}
		}
	}

	private static bool HasSession(string root)
	{
		string[] array = new string[2]
		{
			"data",
			Path.Combine("data", "smoke")
		};
		foreach (string text in array)
		{
			string path = P(root, text);
			if (!Directory.Exists(path))
			{
				continue;
			}
			string[] array2 = new string[2] { "browser", "wecom-push" };
			foreach (string path2 in array2)
			{
				string path3 = P(root, Path.Combine(text, path2));
				if (Directory.Exists(path3) && Directory.EnumerateFileSystemEntries(path3).Any())
				{
					return true;
				}
			}
			if (File.Exists(P(root, Path.Combine(text, "recovery-login.dpapi"))) || File.Exists(P(root, Path.Combine(text, "status.json"))) || Directory.EnumerateFiles(path, "verified-clears-*.json").Any())
			{
				return true;
			}
		}
		return false;
	}

	internal static PortableIsolationInspection Inspect(string executableDirectory)
	{
		string root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(executableDirectory));
		string text = DirectoryIdentity(root);
		JsonObject jsonObject = Read(P(root, ".client-root-transaction.json"), 32768L);
		if (jsonObject != null && Text(jsonObject["rootIdentity"]) == text)
		{
			Recover(root, text, jsonObject);
		}
		JsonObject jsonObject2 = null;
		try
		{
			jsonObject2 = Read(P(root, ".client-root.json"), 32768L);
		}
		catch (Exception ex) when (((ex is JsonException || ex is IOException) ? 1 : 0) != 0)
		{
			if (!HasSession(root))
			{
				throw;
			}
			return new PortableIsolationInspection(root, text, "unverified-existing", null, NeedsChoice: true);
		}
		if (jsonObject != null && Text(jsonObject["rootIdentity"]) != text)
		{
			return new PortableIsolationInspection(root, text, "copied-transaction", null, NeedsChoice: false);
		}
		if (ValidBinding(jsonObject2))
		{
			return new PortableIsolationInspection(root, text, (Text(jsonObject2["rootIdentity"]) == text) ? "existing" : "copy", Text(jsonObject2["installationId"]), NeedsChoice: false);
		}
		return new PortableIsolationInspection(root, text, HasSession(root) ? "legacy-existing" : "fresh", null, HasSession(root));
	}

	private static JsonObject Binding(string identity, string installation)
	{
		return new JsonObject
		{
			["schemaVersion"] = 1,
			["rootIdentity"] = identity,
			["installationId"] = installation,
			["boundAt"] = DateTimeOffset.UtcNow.ToString("O")
		};
	}

	internal static PortableIsolationResult? Apply(PortableIsolationInspection inspection, PortableMigrationChoice choice, IEnumerable<string> publicSettingsKeys, Action<string>? checkpoint = null)
	{
		string root = inspection.Root;
		if (DirectoryIdentity(root) != inspection.RootIdentity)
		{
			throw new IOException("客户端目录已被替换，未启动浏览器。");
		}
		if (inspection.NeedsChoice && choice == PortableMigrationChoice.Cancel)
		{
			return null;
		}
		if (inspection.Kind == "existing")
		{
			return new PortableIsolationResult("existing", inspection.InstallationId, null);
		}
		string kind = inspection.Kind;
		bool flag = ((kind == "copy" || kind == "copied-transaction") ? true : false);
		bool num = flag || choice == PortableMigrationChoice.NewIndependentSpace;
		string text = Guid.NewGuid().ToString("N");
		if (!num)
		{
			Atomic(root, ".client-root.json", Binding(inspection.RootIdentity, text).ToJsonString());
			return new PortableIsolationResult("retained", text, null);
		}
		string text2 = Guid.NewGuid().ToString("N");
		string relative = ".isolation-stage-" + text2;
		string text3 = Path.Combine("archives", "isolation-" + text2);
		string text4 = P(root, relative);
		string text5 = P(root, text3);
		string text6 = P(root, "data");
		HashSet<string> keys = new HashSet<string>(publicSettingsKeys.Where((string key) => key != "wecomPush"), StringComparer.Ordinal);
		if (Directory.Exists(text6))
		{
			ValidateTree(root, text6);
		}
		string[] array = (from path in Directory.EnumerateFiles(root)
			where LogName.IsMatch(Path.GetFileName(path))
			select path).Select(Path.GetFileName).ToArray();
		Directory.CreateDirectory(text4);
		Directory.CreateDirectory(text5);
		RestorePublic(root, text6, text4, keys);
		string text7 = P(root, ".client-root.json");
		if (File.Exists(text7))
		{
			File.Copy(text7, P(root, Path.Combine(text3, "root-binding.previous.json")));
		}
		string text8 = P(root, ".client-root-transaction.json");
		if (File.Exists(text8))
		{
			File.Copy(text8, P(root, Path.Combine(text3, "transaction.previous.json")));
		}
		JsonObject jsonObject = new JsonObject
		{
			["schemaVersion"] = 1,
			["token"] = text2,
			["rootIdentity"] = inspection.RootIdentity,
			["installationId"] = text,
			["hadData"] = Directory.Exists(text6),
			["logs"] = new JsonArray(((IEnumerable<string>)array).Select((Func<string, JsonNode>)((string value) => JsonValue.Create(value))).ToArray())
		};
		Atomic(root, ".client-root-transaction.json", jsonObject.ToJsonString());
		try
		{
			checkpoint?.Invoke("prepared");
			if (Directory.Exists(text6))
			{
				Directory.Move(P(root, "data"), P(root, Path.Combine(text3, "data")));
			}
			checkpoint?.Invoke("data-archived");
			string[] array2 = array;
			foreach (string text9 in array2)
			{
				File.Move(P(root, text9), P(root, Path.Combine(text3, text9)));
			}
			checkpoint?.Invoke("logs-archived");
			Directory.Move(P(root, relative), P(root, "data"));
			checkpoint?.Invoke("fresh-installed");
			Atomic(root, ".client-root.json", Binding(inspection.RootIdentity, text).ToJsonString());
			checkpoint?.Invoke("bound");
			File.Delete(P(root, ".client-root-transaction.json"));
			return new PortableIsolationResult("isolated-copy", text, text5);
		}
		catch
		{
			try
			{
				Recover(root, inspection.RootIdentity, jsonObject);
			}
			catch
			{
			}
			throw;
		}
	}

	private static void ValidateTree(string root, string directory)
	{
		Stack<string> stack = new Stack<string>();
		stack.Push(directory);
		while (stack.Count > 0)
		{
			foreach (string item in Directory.EnumerateFileSystemEntries(stack.Pop()))
			{
				PortableStorage.ValidatePathInRoot(root, item);
				if (Directory.Exists(item))
				{
					stack.Push(item);
				}
			}
		}
	}

	private static void RestorePublic(string root, string data, string stage, HashSet<string> keys)
	{
		if (!Directory.Exists(data))
		{
			return;
		}
		string[] array = new string[2] { "", "smoke" };
		foreach (string path in array)
		{
			if (!Directory.Exists(P(root, Path.Combine("data", path))))
			{
				continue;
			}
			string text = P(root, Path.GetRelativePath(root, Path.Combine(stage, path)));
			Directory.CreateDirectory(text);
			string path2 = P(root, Path.Combine("data", path, "settings.json"));
			if (File.Exists(path2))
			{
				JsonObject jsonObject;
				try
				{
					jsonObject = Read(path2, 8000000L) ?? new JsonObject();
				}
				catch (Exception ex) when (((ex is JsonException || ex is IOException || ex is UnauthorizedAccessException) ? 1 : 0) != 0)
				{
					jsonObject = new JsonObject();
				}
				JsonObject jsonObject2 = new JsonObject();
				foreach (KeyValuePair<string, JsonNode> item in jsonObject)
				{
					if (keys.Contains(item.Key))
					{
						jsonObject2[item.Key] = item.Value?.DeepClone();
					}
				}
				jsonObject2.Remove("wecomPush");
				File.WriteAllText(P(root, Path.GetRelativePath(root, Path.Combine(text, "settings.json"))), jsonObject2.ToJsonString(), Utf8);
			}
			string[] array2 = new string[2] { "custom-plans.json", "browser-optimization.json" };
			foreach (string text2 in array2)
			{
				string text3 = P(root, Path.Combine("data", path, text2));
				if (File.Exists(text3))
				{
					File.Copy(text3, P(root, Path.GetRelativePath(root, Path.Combine(text, text2))));
				}
			}
			string text4 = P(root, Path.Combine("data", path, "skins"));
			if (!Directory.Exists(text4))
			{
				continue;
			}
			foreach (string item2 in Directory.EnumerateFiles(text4, "*", SearchOption.AllDirectories))
			{
				string relativePath = Path.GetRelativePath(text4, item2);
				string text5 = P(root, Path.GetRelativePath(root, Path.Combine(text, "skins", relativePath)));
				Directory.CreateDirectory(Path.GetDirectoryName(text5));
				File.Copy(P(root, Path.GetRelativePath(root, item2)), text5);
			}
		}
	}

	private static void Recover(string root, string identity, JsonObject journal)
	{
		string text = Text(journal["token"]);
		string text2 = Text(journal["installationId"]);
		if (!Token.IsMatch(text) || !Token.IsMatch(text2) || Text(journal["rootIdentity"]) != identity || !(journal["logs"] is JsonArray jsonArray))
		{
			throw new IOException("未完成的隔离事务无法核验，所有旧资料已保留；未启动浏览器。");
		}
		string text3 = Path.Combine("archives", "isolation-" + text);
		if (!Directory.Exists(P(root, text3)))
		{
			throw new IOException("隔离归档暂不可用，未启动浏览器。");
		}
		JsonObject jsonObject;
		try
		{
			jsonObject = Read(P(root, ".client-root.json"), 32768L);
		}
		catch (Exception ex) when (((ex is JsonException || ex is IOException) ? 1 : 0) != 0)
		{
			jsonObject = null;
		}
		if (ValidBinding(jsonObject) && Text(jsonObject["rootIdentity"]) == identity && Text(jsonObject["installationId"]) == text2 && Directory.Exists(P(root, "data")))
		{
			File.Delete(P(root, ".client-root-transaction.json"));
			return;
		}
		string text4 = P(root, Path.Combine(text3, "data"));
		string text5 = P(root, "data");
		if (Directory.Exists(text4))
		{
			if (Directory.Exists(text5))
			{
				Directory.Move(text5, P(root, Path.Combine(text3, "fresh-uncommitted")));
			}
			Directory.Move(text4, text5);
		}
		else if (!Yes(journal["hadData"]) && Directory.Exists(text5))
		{
			Directory.Move(text5, P(root, Path.Combine(text3, "fresh-uncommitted")));
		}
		foreach (JsonNode item in jsonArray)
		{
			string text6 = Text(item);
			if (!LogName.IsMatch(text6))
			{
				throw new IOException("隔离日志清单无效，未启动浏览器。");
			}
			string text7 = P(root, Path.Combine(text3, text6));
			if (File.Exists(text7))
			{
				if (File.Exists(P(root, text6)))
				{
					throw new IOException("隔离日志恢复位置已有文件，旧资料均已保留。");
				}
				File.Move(text7, P(root, text6));
			}
		}
		string text8 = P(root, ".isolation-stage-" + text);
		if (Directory.Exists(text8))
		{
			Directory.Move(text8, P(root, Path.Combine(text3, "public-stage-uncommitted")));
		}
		string path = P(root, Path.Combine(text3, "transaction.previous.json"));
		if (File.Exists(path))
		{
			Atomic(root, ".client-root-transaction.json", File.ReadAllText(path, Utf8));
		}
		else
		{
			File.Delete(P(root, ".client-root-transaction.json"));
		}
	}
}
