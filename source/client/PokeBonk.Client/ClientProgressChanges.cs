using System.Collections.Generic;
using System.Text.Json.Nodes;

namespace PokeBonk.Client;

internal static class ClientProgressChanges
{
	internal static ClientRunOutcome SettlementOutcome(JsonObject end)
	{
		string text = Text(end["endHow"]);
		bool flag = text == "died" || (!Flag(end["cooperative"]) && Flag(end["playerDead"]));
		bool flag2 = !flag && text == "won" && Flag(end["victory"]);
		bool flag3 = Flag(end["saved"]);
		string text2;
		if (!flag3)
		{
			text2 = "本局未确认保存";
		}
		else
		{
			string text3;
			if (flag)
			{
				text3 = "本局死亡并已保存";
			}
			else
			{
				bool flag4 = ((text == "quit" || text == "restart") ? true : false);
				text3 = (flag4 ? "本局主动结束并已保存" : ((text == "error") ? "本局原生异常结束并已保存" : (flag2 ? "本局通关并已保存" : "本局结束并已保存")));
			}
			text2 = text3;
		}
		string title = text2;
		text2 = ((!flag) ? (text switch
		{
			"quit" => "主动结束", 
			"restart" => "原生重新开始", 
			"error" => "原生异常", 
			"won" => "正常通关", 
			_ => "未提供，未据胜利标记推断", 
		}) : "死亡");
		string text4 = text2;
		string text5 = "原生结束原因：" + text4;
		if (Text(end["nativeMode"]) == "tower")
		{
			int? num = Count(end["towerFloor"]);
			int? num2 = Count(end["towerClearedFloor"]);
			if (Flag(end["towerRoof"]))
			{
				text5 += " · 到达塔顶（普通第7层之后）";
			}
			else if (num > 0)
			{
				string text6 = text5;
				int? num3 = num;
				text5 = text6 + " · 到达第 " + num3 + " 层";
			}
			if (num2.HasValue)
			{
				string text7 = text5;
				int? num3 = num2;
				text5 = text7 + " · 已清除 " + num3 + " 层";
			}
		}
		return new ClientRunOutcome(title, flag3 && flag2, text5);
		static int? Count(JsonNode? node)
		{
			if (!(node is JsonValue jsonValue) || !jsonValue.TryGetValue<int>(out var value) || value < 0)
			{
				return null;
			}
			return value;
		}
		static bool Flag(JsonNode? node)
		{
			bool value = default(bool);
			return node is JsonValue jsonValue && jsonValue.TryGetValue<bool>(out value) && value;
		}
		static string? Text(JsonNode? node)
		{
			if (!(node is JsonValue jsonValue) || !jsonValue.TryGetValue<string>(out string value))
			{
				return null;
			}
			return value;
		}
	}

	internal static string? RegionLabel(JsonObject game)
	{
		string value;
		string text = ((game["nativeMode"] is JsonValue jsonValue && jsonValue.TryGetValue<string>(out value)) ? value : "standard");
		if (text == "tower")
		{
			if (!(game["tower"] is JsonObject jsonObject))
			{
				return null;
			}
			bool value2 = default(bool);
			if (jsonObject["roof"] is JsonValue jsonValue2 && jsonValue2.TryGetValue<bool>(out value2) && value2)
			{
				return "塔顶";
			}
			int? num = Integer(jsonObject["floor"]);
			if (!num.HasValue)
			{
				return null;
			}
			bool value3 = default(bool);
			string obj = ((jsonObject["beyond"] is JsonValue jsonValue3 && jsonValue3.TryGetValue<bool>(out value3) && value3) ? "塔顶之后 · " : "");
			int? num2 = num;
			return obj + "第 " + num2 + " 层";
		}
		int? num3 = Integer(game["stage"]);
		if (!num3.HasValue)
		{
			return null;
		}
		if (text == "endless")
		{
			int? num2 = num3;
			return "无尽 · 第 " + num2 + " 阶段";
		}
		if (num3 != 4)
		{
			int? num2 = num3;
			return "第 " + num2 + " 区";
		}
		return "圣域 · 最终战";
		static int? Integer(JsonNode? jsonNode)
		{
			if (!(jsonNode is JsonValue jsonValue4) || !jsonValue4.TryGetValue<int>(out var value4) || value4 <= 0)
			{
				return null;
			}
			return value4;
		}
	}

	internal static IReadOnlyList<ClientProgressChange> Collect(JsonObject previous, JsonObject current)
	{
		List<ClientProgressChange> list = new List<ClientProgressChange>();
		if (current["biomes"] is JsonObject jsonObject)
		{
			foreach (KeyValuePair<string, JsonNode> item in jsonObject)
			{
				if (item.Value is JsonValue jsonValue && jsonValue.TryGetValue<int>(out var value) && value >= 0)
				{
					int value2;
					int num = ((previous["biomes"] is JsonObject jsonObject2 && jsonObject2[item.Key] is JsonValue jsonValue2 && jsonValue2.TryGetValue<int>(out value2)) ? value2 : (-1));
					if (value > num)
					{
						list.Add(new ClientProgressChange("map", item.Key, num, value));
					}
				}
			}
		}
		if (current["lab"] is JsonObject jsonObject3)
		{
			foreach (KeyValuePair<string, JsonNode> item2 in jsonObject3)
			{
				if (item2.Value is JsonValue jsonValue3 && jsonValue3.TryGetValue<int>(out var value3) && value3 >= 0)
				{
					int value4;
					int num2 = ((previous["lab"] is JsonObject jsonObject4 && jsonObject4[item2.Key] is JsonValue jsonValue4 && jsonValue4.TryGetValue<int>(out value4)) ? value4 : 0);
					if (value3 > num2)
					{
						list.Add(new ClientProgressChange("research", item2.Key, num2, value3));
					}
				}
			}
		}
		return list;
	}
}
