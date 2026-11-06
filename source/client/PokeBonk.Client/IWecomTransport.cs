using System;
using System.Threading;
using System.Threading.Tasks;

namespace PokeBonk.Client;

internal interface IWecomTransport : IDisposable
{
	Task<WecomReply> SendAsync(Uri address, string body, CancellationToken token);
}
