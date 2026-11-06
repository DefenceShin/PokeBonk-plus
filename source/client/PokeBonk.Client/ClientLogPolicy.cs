using System;
using System.Linq;
using System.Text.Json.Nodes;

namespace PokeBonk.Client;

internal static class ClientLogPolicy
{
	internal static readonly string[] Filters = new string[14]
	{
		"all", "reward", "run", "error", "shiny", "dex", "appearance", "bonkoin", "stardust", "character",
		"map", "research", "achievement", "permanentItem"
	};

	internal static string Category(JsonObject row)
	{
		return row["category"]?.ToString() ?? Category(row["type"]?.ToString() ?? row["kind"]?.ToString() ?? "info", row["title"]?.ToString() ?? row["message"]?.ToString() ?? "");
	}

	internal static bool Matches(JsonObject row, string filter)
	{
		string text = Category(row);
		if (filter == "all")
		{
			return true;
		}
		if (filter == "reward")
		{
			switch (text)
			{
			case "dex":
			case "map":
			case "research":
			case "stardust":
			case "reward":
			case "shiny":
			case "appearance":
			case "bonkoin":
			case "character":
			case "achievement":
			case "permanentItem":
				return true;
			default:
				return false;
			}
		}
		return text == filter;
	}

	internal static string Category(string kind, string title)
	{
		bool flag;
		switch (kind)
		{
		case "error":
		case "warning":
		case "warn":
			flag = true;
			break;
		default:
			flag = false;
			break;
		}
		if (flag)
		{
			return "error";
		}
		switch (kind)
		{
		case "run":
		case "result":
		case "region":
			flag = true;
			break;
		default:
			flag = false;
			break;
		}
		if (flag)
		{
			return "run";
		}
		if (title.Contains("异色", StringComparison.Ordinal))
		{
			return "shiny";
		}
		if (title.Contains("图鉴", StringComparison.Ordinal))
		{
			return "dex";
		}
		if (title.Contains("邦币", StringComparison.Ordinal))
		{
			return "bonkoin";
		}
		if (title.Contains("外观", StringComparison.Ordinal) || title.Contains("形态", StringComparison.Ordinal) || title.Contains("装扮", StringComparison.Ordinal))
		{
			return "appearance";
		}
		if (title.Contains("星尘", StringComparison.Ordinal))
		{
			return "stardust";
		}
		if (title.Contains("角色", StringComparison.Ordinal) || title.Contains("联盟", StringComparison.Ordinal))
		{
			return "character";
		}
		switch (kind)
		{
		case "unlock":
			return "map";
		case "research":
			return "research";
		case "achievement":
			return "achievement";
		default:
			if (title.Contains("永久道具", StringComparison.Ordinal))
			{
				return "permanentItem";
			}
			if ((!(kind == "reward") && !(kind == "capture")) || 1 == 0)
			{
				return "info";
			}
			return "reward";
		}
	}

	internal static bool Keep(string kind, string title)
	{
		bool flag;
		switch (kind)
		{
		case "capture":
		case "warning":
		case "region":
		case "unlock":
		case "result":
		case "error":
		case "warn":
		case "run":
		case "research":
		case "achievement":
			flag = true;
			break;
		default:
			flag = false;
			break;
		}
		if (flag)
		{
			return true;
		}
		switch (kind)
		{
		case "reward":
			if (title != "获得星尘")
			{
				return title != "本局获得道具";
			}
			return false;
		case "choice":
		case "upgrade":
		case "debug":
			flag = true;
			break;
		default:
			flag = false;
			break;
		}
		if (flag)
		{
			return false;
		}
		if (kind == "info")
		{
			return new string[10] { "恢复", "补存", "重登", "重试", "临时游客", "部署更新", "接口已重新接入", "进度已重新同步", "浏览器优化", "客户端关闭" }.Any(title.Contains);
		}
		return false;
	}
}
