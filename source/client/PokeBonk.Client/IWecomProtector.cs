namespace PokeBonk.Client;

internal interface IWecomProtector
{
	byte[] Protect(byte[] plain);

	byte[] Unprotect(byte[] cipher);
}
