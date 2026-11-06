using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security;
using System.Text;
using System.Text.Json.Nodes;

namespace PokeBonk.Client;

internal static class ClientLogRetentionTransaction
{
	internal sealed record Result(bool TemporaryFilesCleaned);

	private sealed record Backup(string Target, string Copy, bool Existed);

	internal static bool IsOnlyRangePatch(JsonObject patch)
	{
		if (patch.Count == 1)
		{
			return patch.ContainsKey("logRetentionRuns");
		}
		return false;
	}

	internal static Result Commit(PortableStorage portable, string settings, Action applyRetention)
	{
		ArgumentNullException.ThrowIfNull(portable, "portable");
		ArgumentNullException.ThrowIfNull(settings, "settings");
		ArgumentNullException.ThrowIfNull(applyRetention, "applyRetention");
		string text = Guid.NewGuid().ToString("N");
		string path = portable.DataPath(Path.Combine("temp", "log-range-" + text + ".settings-stage"));
		List<Backup> list = new List<Backup>();
		bool flag = false;
		bool flag2 = true;
		List<(string, string)> list2 = new List<(string, string)> { (portable.SettingsPath, "settings") };
		if (ClientLogRetention.Normalize(JsonNode.Parse(settings)?["logRetentionRuns"]) != 0)
		{
			list2.Add((portable.JournalPath, "journal"));
			list2.Add((portable.ReadableLogPath, "readable"));
		}
		try
		{
			foreach (var item4 in list2)
			{
				string item = item4.Item1;
				string item2 = item4.Item2;
				string text2 = portable.DataPath(Path.Combine("temp", "log-range-" + text + "." + item2 + "-backup"));
				bool flag3 = File.Exists(portable.ValidatePath(item));
				list.Add(new Backup(item, text2, flag3));
				if (flag3)
				{
					File.Copy(portable.ValidatePath(item), portable.ValidatePath(text2), overwrite: false);
				}
			}
			using (FileStream fileStream = new FileStream(portable.ValidatePath(path), FileMode.CreateNew, FileAccess.Write, FileShare.None))
			{
				fileStream.Write(new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true).GetBytes(settings));
				fileStream.Flush(flushToDisk: true);
			}
			flag = true;
			File.Move(portable.ValidatePath(path), portable.ValidatePath(portable.SettingsPath), overwrite: true);
			applyRetention();
		}
		catch (Exception ex)
		{
			if (flag)
			{
				List<Exception> list3 = new List<Exception>();
				foreach (Backup item5 in list)
				{
					try
					{
						if (item5.Existed)
						{
							if (!Identical(portable, item5.Target, item5.Copy))
							{
								File.Copy(portable.ValidatePath(item5.Copy), portable.ValidatePath(item5.Target), overwrite: true);
							}
						}
						else if (File.Exists(portable.ValidatePath(item5.Target)))
						{
							File.Delete(portable.ValidatePath(item5.Target));
						}
					}
					catch (Exception item3)
					{
						list3.Add(item3);
					}
				}
				if (list3.Count > 0)
				{
					flag2 = false;
					throw new AggregateException("日志范围未能提交，部分文件恢复失败；原始备份已保留，请检查客户端数据目录。", new Exception[1] { ex }.Concat(list3));
				}
			}
			throw;
		}
		finally
		{
			TryDelete(portable, path);
			if (flag2)
			{
				foreach (Backup item6 in list)
				{
					TryDelete(portable, item6.Copy);
				}
			}
		}
		return new Result(!File.Exists(path) && list.All((Backup backup) => !File.Exists(backup.Copy)));
	}

	private static bool Identical(PortableStorage portable, string first, string second)
	{
		if (!File.Exists(portable.ValidatePath(first)) || !File.Exists(portable.ValidatePath(second)))
		{
			return false;
		}
		using FileStream fileStream = new FileStream(portable.ValidatePath(first), FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
		using FileStream fileStream2 = new FileStream(portable.ValidatePath(second), FileMode.Open, FileAccess.Read, FileShare.Read);
		if (fileStream.Length != fileStream2.Length)
		{
			return false;
		}
		byte[] array = new byte[16384];
		byte[] array2 = new byte[16384];
		int length;
		while ((length = fileStream.Read(array)) > 0)
		{
			fileStream2.ReadExactly(array2.AsSpan(0, length));
			if (!array.AsSpan(0, length).SequenceEqual(array2.AsSpan(0, length)))
			{
				return false;
			}
		}
		return fileStream2.Position == fileStream2.Length;
	}

	private static void TryDelete(PortableStorage portable, string path)
	{
		try
		{
			if (File.Exists(portable.ValidatePath(path)))
			{
				File.SetAttributes(portable.ValidatePath(path), FileAttributes.Normal);
				File.Delete(portable.ValidatePath(path));
			}
		}
		catch (Exception ex) when (((ex is IOException || ex is UnauthorizedAccessException || ex is SecurityException) ? 1 : 0) != 0)
		{
		}
	}
}
