namespace PokeBonk.Client;

internal sealed record PrerequisiteSignature(bool Valid, string Signer, string Thumbprint, string? Failure = null);
