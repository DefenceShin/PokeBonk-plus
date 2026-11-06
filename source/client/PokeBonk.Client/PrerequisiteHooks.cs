using System;
using System.Threading.Tasks;

namespace PokeBonk.Client;

internal sealed class PrerequisiteHooks
{
	internal Func<PrerequisiteSystem> System { get; init; } = PrerequisiteService.ReadSystem;

	internal Func<string?> Runtime { get; init; } = PrerequisiteService.ReadRuntimeVersion;

	internal Func<string, PrerequisiteSignature> Signature { get; init; } = WindowsInstallerTrust.Verify;

	internal Func<PrerequisiteInstallerRequest, Task<int>> Execute { get; init; } = PrerequisiteService.ExecuteInstallerAsync;

	internal Func<TimeSpan, Task> Delay { get; init; } = Task.Delay;

	internal Func<PrerequisiteSystem, PrerequisitePackage> Package { get; init; } = PrerequisitePackage.ForSystem;
}
