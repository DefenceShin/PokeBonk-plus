using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace PokeBonk.Client;

internal sealed class HostPerformance
{
	private readonly Queue<Dictionary<string, double>> ticks = new Queue<Dictionary<string, double>>();

	internal void Add(Dictionary<string, double> sample)
	{
		ticks.Enqueue(new Dictionary<string, double>(sample));
		while (ticks.Count > 120)
		{
			ticks.Dequeue();
		}
	}

	internal JsonObject Snapshot()
	{
		JsonObject jsonObject = new JsonObject();
		foreach (string key in ticks.SelectMany((Dictionary<string, double> tick) => tick.Keys).Distinct())
		{
			double[] array = (from tick in ticks
				where tick.ContainsKey(key)
				select tick[key]).Order().ToArray();
			jsonObject[key] = new JsonObject
			{
				["samples"] = array.Length,
				["p50"] = array[(array.Length - 1) / 2],
				["p95"] = array[(int)Math.Floor((double)(array.Length - 1) * 0.95)],
				["max"] = array[^1],
				["mean"] = array.Average()
			};
		}
		return new JsonObject
		{
			["scope"] = "最近最多120次宿主状态采样；ms为宿主墙钟耗时，含IPC等待，不等于游戏CPU或FPS",
			["samples"] = ticks.Count,
			["metrics"] = jsonObject
		};
	}
}
