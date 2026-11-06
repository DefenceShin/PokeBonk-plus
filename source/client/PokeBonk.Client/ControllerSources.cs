using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace PokeBonk.Client;

internal static class ControllerSources
{
	internal static IReadOnlyList<ControllerSource> Read(Func<string, string> resource)
	{
		return ReadEntries(resource, loadText: true);
	}

	private static IReadOnlyList<ControllerSource> ReadEntries(Func<string, string> resource, bool loadText)
	{
		using JsonDocument jsonDocument = JsonDocument.Parse(resource("payload.controller-sources.json"));
		JsonElement rootElement = jsonDocument.RootElement;
		if (rootElement.ValueKind != JsonValueKind.Object || !(from p in rootElement.EnumerateObject()
			select p.Name).Order().SequenceEqual(new string[2] { "entries", "schemaVersion" }) || rootElement.GetProperty("schemaVersion").GetInt32() != 1 || rootElement.GetProperty("entries").ValueKind != JsonValueKind.Array)
		{
			throw new InvalidDataException("控制模块清单无效。");
		}
		JsonElement property = rootElement.GetProperty("entries");
		int arrayLength = property.GetArrayLength();
		if ((arrayLength < 3 || arrayLength > 64) ? true : false)
		{
			throw new InvalidDataException("控制模块数量无效。");
		}
		HashSet<string> hashSet = new HashSet<string>(StringComparer.Ordinal);
		HashSet<int> hashSet2 = new HashSet<int>();
		List<ControllerSource> sources = new List<ControllerSource>();
		foreach (JsonElement item in property.EnumerateArray())
		{
			if (item.ValueKind != JsonValueKind.Object || !(from p in item.EnumerateObject()
				select p.Name).Order().SequenceEqual(new string[3] { "loadOrder", "name", "scope" }))
			{
				throw new InvalidDataException("控制模块条目无效。");
			}
			string text = item.GetProperty("name").GetString();
			string text2 = item.GetProperty("scope").GetString();
			int @int = item.GetProperty("loadOrder").GetInt32();
			bool flag = text == null || !Regex.IsMatch(text, "^[a-z][a-z0-9-]{0,63}$", RegexOptions.CultureInvariant);
			if (!flag)
			{
				bool flag2 = ((text2 == "shared" || text2 == "isolated") ? true : false);
				flag = !flag2;
			}
			if (flag || @int < 0 || @int >= property.GetArrayLength() || !hashSet.Add(text) || !hashSet2.Add(@int))
			{
				throw new InvalidDataException("控制模块条目重复或不安全。");
			}
			sources.Add(new ControllerSource(text, text2, @int, loadText ? resource("payload." + text + ".mjs") : string.Empty));
		}
		if (!new string[3] { "policy", "pilot", "compatibility" }.All(hashSet.Contains) || sources.Any((ControllerSource s) => s.Scope == "shared" && sources.Any((ControllerSource i) => i.Scope == "isolated" && i.LoadOrder < s.LoadOrder)))
		{
			throw new InvalidDataException("控制模块依赖顺序无效。");
		}
		return sources;
	}

	internal static string ServiceSource(Func<string, string> resource, Func<string, string> browserSource, params string[] roots)
	{
		HashSet<string> allowed = (from row in ReadEntries(resource, loadText: false)
			where row.Scope == "shared"
			select row.Name).ToHashSet<string>(StringComparer.Ordinal);
		HashSet<string> added = new HashSet<string>(StringComparer.Ordinal);
		HashSet<string> visiting = new HashSet<string>(StringComparer.Ordinal);
		List<string> output = new List<string>();
		for (int num = 0; num < roots.Length; num++)
		{
			Visit(roots[num], root: true);
		}
		return string.Join("\n", output);
		void Visit(string payload, bool root)
		{
			Match match = Regex.Match(payload, "^payload\\.([a-z][a-z0-9-]{0,63})\\.mjs$", RegexOptions.CultureInvariant);
			if (!match.Success || (!root && !allowed.Contains(match.Groups[1].Value)))
			{
				throw new InvalidDataException("本地模块依赖未登记或不安全。");
			}
			if (!added.Contains(payload))
			{
				if (!visiting.Add(payload))
				{
					throw new InvalidDataException("本地模块存在循环依赖。");
				}
				string text = resource(payload);
				foreach (Match item in Regex.Matches(text, "(?m)^import\\b[^;]*;"))
				{
					Match match2 = Regex.Match(item.Value, "^import\\s+[\\s\\S]*?\\s+from\\s*['\"]\\./(?<name>[a-z][a-z0-9-]{0,63})\\.mjs['\"]\\s*;$", RegexOptions.CultureInvariant);
					if (!match2.Success)
					{
						throw new InvalidDataException("本地模块含不支持的导入。");
					}
					Visit("payload." + match2.Groups["name"].Value + ".mjs", root: false);
				}
				visiting.Remove(payload);
				added.Add(payload);
				output.Add(browserSource(text));
			}
		}
	}

	internal static string Revision(IReadOnlyList<ControllerSource> sources, string manifestText)
	{
		return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Concat(manifestText, "\0", string.Concat(sources.Select((ControllerSource s) => s.Text)))))).Substring(0, 12).ToLowerInvariant();
	}

	internal static string SharedSource(IReadOnlyList<ControllerSource> sources, Func<string, string> browserSource)
	{
		return string.Join("\n", from s in sources
			where s.Scope == "shared"
			orderby s.LoadOrder
			select browserSource(s.Text));
	}
}
