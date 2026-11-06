namespace PokeBonk.Client;

internal sealed record WecomReply(string State, string Reason, bool Retry = false, bool Limited = false);
