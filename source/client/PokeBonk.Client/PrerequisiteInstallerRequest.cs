using System.Collections.Generic;

namespace PokeBonk.Client;

public sealed record PrerequisiteInstallerRequest(string FileName, string WorkingDirectory, string TemporaryDirectory, IReadOnlyList<string> Arguments);
