using System;
using System.Globalization;
using System.Linq;
using System.Text.Json.Nodes;

namespace PokeBonk.Client;

internal static class ActivationCalendar
{
	internal static bool Allowed(JsonNode? convenience, DateTimeOffset now)
	{
		JsonNode jsonNode = convenience?["rhythm"] ?? convenience?["detection"];
		if ((jsonNode != null && jsonNode["enabled"]?.GetValue<bool>() == false) || jsonNode == null || jsonNode["activationSchedule"]?.GetValue<bool>() != true)
		{
			return true;
		}
		if (!TimeOnly.TryParseExact(jsonNode["activationStart"]?.GetValue<string>(), "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var result) || !TimeOnly.TryParseExact(jsonNode["activationEnd"]?.GetValue<string>(), "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var result2) || !(jsonNode["activationDays"] is JsonArray { Count: not 0 } jsonArray))
		{
			return false;
		}
		DateTimeOffset dateTimeOffset = now.ToOffset(TimeSpan.FromHours(8.0));
		TimeOnly timeOnly = TimeOnly.FromDateTime(dateTimeOffset.DateTime);
		DateTime dateTime = dateTimeOffset.Date;
		if (result2 > result)
		{
			if (timeOnly < result || timeOnly >= result2)
			{
				return false;
			}
		}
		else if (result2 < result)
		{
			if (timeOnly < result2)
			{
				dateTime = dateTime.AddDays(-1.0);
			}
			else if (timeOnly < result)
			{
				return false;
			}
		}
		else if (timeOnly < result)
		{
			dateTime = dateTime.AddDays(-1.0);
		}
		int weekday = (int)dateTime.DayOfWeek;
		if (weekday == 0)
		{
			weekday = 7;
		}
		int value;
		return jsonArray.Any((JsonNode day) => day is JsonValue jsonValue && jsonValue.TryGetValue<int>(out value) && value == weekday);
	}
}
