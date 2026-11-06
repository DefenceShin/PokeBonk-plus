using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json.Nodes;

namespace PokeBonk.Client;

internal sealed class ClientSavedRewardTracker
{
	private bool initialized;

	private readonly Dictionary<string, HashSet<string>> known = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

	private readonly Dictionary<string, Dictionary<string, int>> levels = new Dictionary<string, Dictionary<string, int>>(StringComparer.Ordinal);

	private long? totalBonk;

	private long? totalStardust;

	private static readonly (string Field, string Category, string Title)[] Sets = new(string, string, string)[8]
	{
		("seen", "dex", "新增图鉴已保存"),
		("league", "character", "新角色已加入联盟"),
		("shinies", "shiny", "新增异色已保存"),
		("classics", "appearance", "新增经典外观已保存"),
		("forms", "appearance", "新增形态已保存"),
		("cosmetics", "appearance", "新增装扮已保存"),
		("quests", "achievement", "成就已完成并保存"),
		("itemsOwned", "permanentItem", "新增永久道具已保存")
	};

	internal bool Initialized => initialized;

	internal void Reset()
	{
		initialized = false;
		known.Clear();
		levels.Clear();
		totalBonk = (totalStardust = null);
	}

	private static long? Count(JsonNode? value)
	{
		if (!(value is JsonValue jsonValue) || !jsonValue.TryGetValue<long>(out var value2) || value2 < 0)
		{
			if (!(value is JsonValue jsonValue2) || !jsonValue2.TryGetValue<int>(out var value3) || value3 < 0)
			{
				return null;
			}
			return value3;
		}
		return value2;
	}

	internal IReadOnlyList<ClientSavedReward> Observe(JsonObject profile)
	{
		List<ClientSavedReward> result = new List<ClientSavedReward>();
		(string, string, string)[] sets = Sets;
		for (int i = 0; i < sets.Length; i++)
		{
			var (field, category, title) = sets[i];
			object obj;
			if (!(profile[field] is JsonArray source))
			{
				obj = ((field == "quests" && profile[field] is JsonObject source2) ? (from pair in source2
					where pair.Value is JsonValue jsonValue && ((jsonValue.TryGetValue<bool>(out var value4) && value4) || Count(jsonValue) > 0)
					select pair.Key) : null);
			}
			else
			{
				IEnumerable<string> enumerable = source.OfType<JsonValue>().Select(delegate(JsonValue jsonValue)
				{
					string text2 = field;
					if ((!(text2 == "cosmetics") && !(text2 == "itemsOwned")) || 1 == 0)
					{
						long? num4 = Count(jsonValue);
						if (num4.HasValue)
						{
							long valueOrDefault2 = num4.GetValueOrDefault();
							if (valueOrDefault2 > 0 && valueOrDefault2 <= int.MaxValue)
							{
								return valueOrDefault2.ToString(CultureInfo.InvariantCulture);
							}
						}
						return (string)null;
					}
					if (jsonValue.TryGetValue<string>(out string value4))
					{
						int length = value4.Length;
						if (length > 0 && length <= 256)
						{
							return value4;
						}
					}
					return (string)null;
				}).OfType<string>();
				obj = enumerable;
			}
			IEnumerable<string> enumerable2 = (IEnumerable<string>)obj;
			if (enumerable2 == null)
			{
				continue;
			}
			HashSet<string> value;
			bool flag = known.TryGetValue(field, out value);
			if (!flag)
			{
				value = (known[field] = new HashSet<string>(StringComparer.Ordinal));
			}
			foreach (string item in enumerable2)
			{
				if (item.Length != 0 && value.Add(item) && initialized && flag)
				{
					result.Add(new ClientSavedReward(category, title, item));
				}
			}
		}
		Currency("totalBonk", "bonkoin", "邦币收益已保存", ref totalBonk);
		Currency("totalStardust", "stardust", "星尘收益已保存", ref totalStardust);
		(string, string, string)[] array = new(string, string, string)[2]
		{
			("biomes", "map", "地图进度已保存"),
			("lab", "research", "研究等级已更新")
		};
		for (int i = 0; i < array.Length; i++)
		{
			var (text, category2, title2) = array[i];
			if (!(profile[text] is JsonObject jsonObject))
			{
				continue;
			}
			Dictionary<string, int> value2;
			bool flag2 = levels.TryGetValue(text, out value2);
			if (!flag2)
			{
				value2 = (levels[text] = new Dictionary<string, int>(StringComparer.Ordinal));
			}
			foreach (KeyValuePair<string, JsonNode> item2 in jsonObject)
			{
				long? num = Count(item2.Value);
				if (!num.HasValue)
				{
					continue;
				}
				long valueOrDefault = num.GetValueOrDefault();
				if (valueOrDefault <= int.MaxValue)
				{
					int num2 = (int)valueOrDefault;
					int value3;
					int num3 = (value2.TryGetValue(item2.Key, out value3) ? value3 : ((text == "biomes") ? (-1) : 0));
					if (initialized && flag2 && num2 > num3)
					{
						result.Add(new ClientSavedReward(category2, title2, item2.Key, num2 - num3, num3, num2));
					}
					value2[item2.Key] = Math.Max(num3, num2);
				}
			}
		}
		initialized = true;
		return result;
		void Currency(string propertyName, string category3, string title3, ref long? prior)
		{
			long? num4 = Count(profile[propertyName]);
			if (num4.HasValue)
			{
				long valueOrDefault2 = num4.GetValueOrDefault();
				if (initialized)
				{
					num4 = prior;
					if (num4.HasValue)
					{
						long valueOrDefault3 = num4.GetValueOrDefault();
						if (valueOrDefault2 > valueOrDefault3)
						{
							result.Add(new ClientSavedReward(category3, title3, "", (int)Math.Min(2147483647L, valueOrDefault2 - valueOrDefault3)));
						}
					}
				}
				prior = Math.Max(prior ?? valueOrDefault2, valueOrDefault2);
			}
		}
	}
}
