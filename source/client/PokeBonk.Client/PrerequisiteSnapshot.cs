using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace PokeBonk.Client;

public sealed record PrerequisiteSnapshot(string Status, string[] Missing, string? RuntimeVersion, bool Supported, bool InstallerAvailable, string Reason, string Progress = "", bool CanInstall = false, int? InstallerExitCode = null, bool RestartRequired = false)
{
	public bool Ready => Status == "ready";

	public JsonObject ToJson()
	{
		return new JsonObject
		{
			["status"] = Status,
			["missing"] = new JsonArray(((IEnumerable<string>)Missing).Select((Func<string, JsonNode>)((string x) => JsonValue.Create(x))).ToArray()),
			["runtimeVersion"] = RuntimeVersion,
			["supported"] = Supported,
			["minimumRuntimeMajor"] = 98,
			["installerAvailable"] = InstallerAvailable,
			["reason"] = Reason,
			["progress"] = Progress,
			["canInstall"] = CanInstall,
			["installerExitCode"] = InstallerExitCode,
			["restartRequired"] = RestartRequired
		};
	}
}
