using System.IO;

namespace PokeBonk.Client;

internal sealed class PortableInstanceInUseException : IOException
{
	internal PortableInstanceInUseException()
		: base("这个文件夹中的客户端已在运行，或目录正被另一个客户端占用。请使用另一份完整文件夹。")
	{
	}
}
