namespace PokeBonk.Client;

internal sealed record ClientProgressChange(string Kind, string Key, int Before, int After);
