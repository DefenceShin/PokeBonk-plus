namespace PokeBonk.Client;

internal sealed record ClientProcessIdentity(int Id, string? Name, string? ExecutablePath, string? Product, string? OriginalFilename, bool MetadataUnavailable = false);
