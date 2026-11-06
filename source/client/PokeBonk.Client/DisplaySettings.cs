using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace PokeBonk.Client;

internal static class DisplaySettings
{
	internal static readonly string[] Modes = new string[4] { "fit16x9", "adaptive", "fit16x10", "fit4x3" };

	internal static JsonObject Defaults()
	{
		return new JsonObject { ["mode"] = "fit16x9" };
	}

	internal static JsonObject Normalize(JsonNode? input)
	{
		JsonObject jsonObject = ((input is JsonObject jsonObject2) ? jsonObject2.DeepClone().AsObject() : new JsonObject());
		if (!(jsonObject["mode"] is JsonValue jsonValue) || !jsonValue.TryGetValue<string>(out string value) || !Modes.Contains(value))
		{
			jsonObject["mode"] = "fit16x9";
		}
		return jsonObject;
	}

	internal static JsonObject Merge(JsonNode? current, JsonNode? input)
	{
		if (!(input is JsonObject jsonObject))
		{
			throw new InvalidOperationException("画面显示设置必须是对象。");
		}
		if (jsonObject.ContainsKey("mode") && (!(jsonObject["mode"] is JsonValue jsonValue) || !jsonValue.TryGetValue<string>(out string value) || !Modes.Contains(value)))
		{
			throw new InvalidOperationException("画面比例选项无效。");
		}
		JsonObject jsonObject2 = Normalize(current);
		foreach (KeyValuePair<string, JsonNode> item in jsonObject)
		{
			jsonObject2[item.Key] = item.Value?.DeepClone();
		}
		return jsonObject2;
	}

	internal static (double Width, double Height) Fit(double width, double height, string mode)
	{
		if (!double.IsFinite(width) || !double.IsFinite(height) || width <= 0.0 || height <= 0.0)
		{
			return (Width: 0.0, Height: 0.0);
		}
		double num = mode switch
		{
			"fit16x10" => 1.6, 
			"fit4x3" => 1.3333333333333333, 
			"adaptive" => 0.0, 
			_ => 1.7777777777777777, 
		};
		if (num == 0.0)
		{
			return (Width: width, Height: height);
		}
		double num2 = Math.Min(width, height * num);
		return (Width: num2, Height: num2 / num);
	}

	internal static double PanelMaximum(double height, double gameMinimum, double splitterHeight, double panelMinimum)
	{
		if (!double.IsFinite(height) || !(height > 0.0))
		{
			return 850.0;
		}
		return Math.Max(panelMinimum, Math.Min(850.0, height - gameMinimum - splitterHeight));
	}
}
