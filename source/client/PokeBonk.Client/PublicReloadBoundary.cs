namespace PokeBonk.Client;

internal sealed record PublicReloadBoundary(object Core, string Document, long Page, long Intent, long Recovery, string? ExpectedIdentity, string? ObservedIdentity, bool Wanted, bool Requested, bool Scheduled, bool Closing);
