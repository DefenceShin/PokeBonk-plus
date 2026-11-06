namespace PokeBonk.Client;

internal sealed record ClientSavedReward(string Category, string Title, string Key, int Amount = 1, int Before = -1, int After = -1);
