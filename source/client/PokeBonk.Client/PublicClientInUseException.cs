using System.IO;

namespace PokeBonk.Client;

internal sealed class PublicClientInUseException : IOException
{
	internal PublicClientInUseException(bool unableToVerify = false)
		: base(unableToVerify ? "无法完成旅伴客户端实例检查：另一个同名进程或本机实例锁当前不可核验。请先关闭已运行的旅伴，并以相同的 Windows 权限重试。" : "已有旅伴客户端正在运行。公开版不支持在同一 Windows 中重复启动，请先关闭已有客户端后再试。")
	{
	}
}
