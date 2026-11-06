using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace PokeBonk.Client;

public sealed class PrerequisiteService
{
	public const int MinimumRuntimeMajor = 98;

	private readonly PortableStorage storage;

	private readonly PrerequisiteHooks hooks;

	private int installing;

	private long inspectionGeneration;

	private readonly object stateLock = new object();

	private PrerequisiteSnapshot current = new PrerequisiteSnapshot("checking", Array.Empty<string>(), null, Supported: false, InstallerAvailable: false, "正在检查运行前置。", "正在检查");

	public PrerequisiteSnapshot Current
	{
		get
		{
			lock (stateLock)
			{
				return current;
			}
		}
	}

	public bool IsInstalling => Volatile.Read(in installing) != 0;

	public event Action<PrerequisiteSnapshot>? Changed;

	public PrerequisiteService(PortableStorage storage)
		: this(storage, new PrerequisiteHooks())
	{
	}

	internal PrerequisiteService(PortableStorage storage, PrerequisiteHooks hooks)
	{
		this.storage = storage ?? throw new ArgumentNullException("storage");
		this.hooks = hooks ?? throw new ArgumentNullException("hooks");
	}

	private PrerequisiteSnapshot Publish(PrerequisiteSnapshot snapshot)
	{
		lock (stateLock)
		{
			current = snapshot;
		}
		Action<PrerequisiteSnapshot> action = this.Changed;
		if (action != null)
		{
			Delegate[] invocationList = action.GetInvocationList();
			for (int i = 0; i < invocationList.Length; i++)
			{
				Action<PrerequisiteSnapshot> action2 = (Action<PrerequisiteSnapshot>)invocationList[i];
				try
				{
					action2(snapshot);
				}
				catch
				{
				}
			}
		}
		return snapshot;
	}

	public async Task<PrerequisiteSnapshot> InspectAsync(CancellationToken cancellationToken = default(CancellationToken))
	{
		if (IsInstalling)
		{
			return Current;
		}
		long generation = Interlocked.Increment(ref inspectionGeneration);
		PrerequisiteSnapshot snapshot = await Task.Run(() => Inspect(cancellationToken), cancellationToken);
		return (IsInstalling || Volatile.Read(in inspectionGeneration) != generation) ? Current : Publish(snapshot);
	}

	private PrerequisiteSnapshot Inspect(CancellationToken cancellationToken)
	{
		cancellationToken.ThrowIfCancellationRequested();
		PrerequisiteSystem prerequisiteSystem = hooks.System();
		if (!prerequisiteSystem.Supported)
		{
			return Unsupported(prerequisiteSystem);
		}
		string text;
		string text2;
		try
		{
			text = RuntimeCandidate(hooks.Runtime());
			text2 = ValidRuntime(text);
		}
		catch (WebView2RuntimeNotFoundException)
		{
			text2 = (text = null);
		}
		catch (Exception ex2)
		{
			return new PrerequisiteSnapshot("error", new string[1] { "WebView2 Runtime 检测" }, null, Supported: true, InstallerAvailable: false, "无法检测 WebView2 Runtime，请重新解压完整版客户端后重试：" + ex2.Message);
		}
		try
		{
			using (ValidatePackage(prerequisiteSystem, cancellationToken))
			{
				return (text2 != null) ? new PrerequisiteSnapshot("ready", Array.Empty<string>(), text2, Supported: true, InstallerAvailable: true, "运行前置齐全。") : ((text != null) ? new PrerequisiteSnapshot("outdated", new string[1] { "Microsoft Edge WebView2 Runtime 更新" }, text, Supported: true, InstallerAvailable: true, $"已安装 WebView2 {text}，版本过旧。客户端及游戏需要 {98} 或更新版本；点击“下载前置”使用内置离线包升级。", "", CanInstall: true) : new PrerequisiteSnapshot("missing", new string[1] { "Microsoft Edge WebView2 Runtime" }, null, Supported: true, InstallerAvailable: true, "缺少 WebView2 Runtime。完整离线安装包已随客户端提供，点击右下角“下载前置”即可安装。", "", CanInstall: true));
			}
		}
		catch (Exception ex3) when (IsPackageError(ex3))
		{
			return (text2 != null) ? new PrerequisiteSnapshot("ready", Array.Empty<string>(), text2, Supported: true, InstallerAvailable: false, "已检测到可用 Runtime；内置安装包不可用，仅重装前置时需要重新解压完整版。" + ex3.Message) : new PrerequisiteSnapshot("invalid-package", new string[1] { "Microsoft Edge WebView2 Runtime" }, text, Supported: true, InstallerAvailable: false, "内置前置安装包缺失或校验失败，请重新解压完整版客户端，保留 EXE 旁 prerequisites 文件夹。" + ex3.Message);
		}
	}

	public async Task<PrerequisiteSnapshot> InstallMissingAsync(CancellationToken cancellationToken = default(CancellationToken))
	{
		if (Interlocked.CompareExchange(ref installing, 1, 0) != 0)
		{
			return Current;
		}
		Interlocked.Increment(ref inspectionGeneration);
		int? exitCode = null;
		try
		{
			cancellationToken.ThrowIfCancellationRequested();
			PrerequisiteSystem system = hooks.System();
			if (!system.Supported)
			{
				return Publish(Unsupported(system));
			}
			string text = await Task.Run(() => DetectRuntime(), cancellationToken);
			if (text != null)
			{
				return Publish(new PrerequisiteSnapshot("ready", Array.Empty<string>(), text, Supported: true, InstallerAvailable: false, "运行前置已可用，无需重复安装。"));
			}
			Publish(new PrerequisiteSnapshot("checking", new string[1] { "Microsoft Edge WebView2 Runtime" }, null, Supported: true, InstallerAvailable: false, "正在核验客户端内置的微软离线安装包。", "核验文件大小、SHA256 和微软数字签名"));
			using FileStream package = await Task.Run(() => ValidatePackage(system, cancellationToken), cancellationToken);
			cancellationToken.ThrowIfCancellationRequested();
			string temporaryDirectory = storage.EnsureDirectory(storage.DataPath(Path.Combine("temp", "prerequisites")));
			PrerequisiteInstallerRequest arg = new PrerequisiteInstallerRequest(package.Name, Path.GetDirectoryName(package.Name), temporaryDirectory, new _003C_003Ez__ReadOnlyArray<string>(new string[2] { "/silent", "/install" }));
			Publish(new PrerequisiteSnapshot("installing", new string[1] { "Microsoft Edge WebView2 Runtime" }, null, Supported: true, InstallerAvailable: true, "正在安装微软 WebView2 Runtime。请等待；此步骤使用随包离线安装器。", "安装程序运行中"));
			exitCode = await hooks.Execute(arg);
			Publish(new PrerequisiteSnapshot("verifying", new string[1] { "Microsoft Edge WebView2 Runtime" }, null, Supported: true, InstallerAvailable: true, "安装器已退出（退出码 " + FormatExitCode(exitCode.Value) + "），正在重新检测 Runtime。", "重新检测 Runtime", CanInstall: false, exitCode));
			string runtime = null;
			string detectionError = null;
			for (int attempt = 0; attempt < 8; attempt++)
			{
				try
				{
					runtime = await Task.Run((Func<string>)DetectRuntime);
				}
				catch (Exception ex)
				{
					detectionError = ex.Message;
				}
				if (runtime != null)
				{
					break;
				}
				if (attempt < 7)
				{
					await hooks.Delay(TimeSpan.FromSeconds(1.0));
				}
			}
			bool flag;
			switch (exitCode)
			{
			case 1641:
			case 3010:
				flag = true;
				break;
			default:
				flag = false;
				break;
			}
			bool flag2 = flag;
			if (runtime != null)
			{
				return Publish(new PrerequisiteSnapshot("ready", Array.Empty<string>(), runtime, Supported: true, InstallerAvailable: true, (exitCode == 0) ? "前置安装完成，已重新检测到可用 WebView2 Runtime。" : ("已检测到可用 WebView2 Runtime；安装器退出码 " + FormatExitCode(exitCode.Value) + "。" + (flag2 ? "安装器报告系统重启提示。" : "")), "", CanInstall: false, exitCode, flag2));
			}
			return Publish(new PrerequisiteSnapshot(flag2 ? "restart-required" : "error", new string[1] { "Microsoft Edge WebView2 Runtime" }, null, Supported: true, InstallerAvailable: true, flag2 ? "安装器返回重启提示，但 Runtime 尚不可用。请先保存其他工作并手动重启 Windows，再打开客户端检查。" : ("安装结束但尚未检测到可用 Runtime（退出码 " + FormatExitCode(exitCode.Value) + "）。可重试；如仍失败，请检查系统安装权限或联系维护者。" + ((detectionError == null) ? "" : (" 检测信息：" + detectionError))), "", !flag2, exitCode, flag2));
		}
		catch (OperationCanceledException) when (!exitCode.HasValue)
		{
			return Publish(new PrerequisiteSnapshot("error", new string[1] { "Microsoft Edge WebView2 Runtime" }, null, Supported: true, InstallerAvailable: false, "安装尚未启动，检查已取消。可重新检查后重试。"));
		}
		catch (Exception ex3)
		{
			bool flag3 = IsPackageError(ex3);
			return Publish(new PrerequisiteSnapshot(flag3 ? "invalid-package" : "error", new string[1] { "Microsoft Edge WebView2 Runtime" }, null, Supported: true, !flag3, flag3 ? ("内置安装包校验失败，请重新解压完整版客户端。" + ex3.Message) : ("前置安装未完成，可重试。" + ex3.Message), "", !flag3, exitCode));
		}
		finally
		{
			Interlocked.Exchange(ref installing, 0);
		}
	}

	private string? DetectRuntime()
	{
		try
		{
			return ValidRuntime(hooks.Runtime());
		}
		catch (WebView2RuntimeNotFoundException)
		{
			return null;
		}
	}

	private static string? RuntimeCandidate(string? value)
	{
		if (!Version.TryParse(value, out Version result) || result.Major <= 0)
		{
			return null;
		}
		return value;
	}

	private static string? ValidRuntime(string? value)
	{
		if (!Version.TryParse(value, out Version result) || result.Major < 98)
		{
			return null;
		}
		return value;
	}

	private static bool IsPackageError(Exception error)
	{
		if (error is IOException || error is UnauthorizedAccessException || error is CryptographicException || error is JsonException || error is InvalidDataException || error is KeyNotFoundException || error is InvalidOperationException || error is FormatException || error is OverflowException)
		{
			return true;
		}
		return false;
	}

	public string ReadLicenseText()
	{
		string path = storage.RootPath(Path.Combine("prerequisites", "Microsoft-WebView2-Runtime-License.txt"));
		using FileStream fileStream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
		storage.ValidatePath(path);
		long length = fileStream.Length;
		if ((length > 1048576 || length == 0L) ? true : false)
		{
			throw new InvalidDataException("微软许可文本缺失或大小异常。");
		}
		using StreamReader streamReader = new StreamReader(fileStream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
		return streamReader.ReadToEnd();
	}

	private static PrerequisiteSnapshot Unsupported(PrerequisiteSystem system)
	{
		return new PrerequisiteSnapshot("unsupported", new string[1] { "受支持的 Windows 系统与 x64 进程" }, null, Supported: false, InstallerAvailable: false, $"同一客户端支持 Windows 10 1709+ x64（另支持 1607 LTSC / Server 2016）、Windows 11 x64，以及 Windows 11 ARM64 的 x64 仿真环境。Windows 10 ARM、32 位 Windows 和原生 macOS 不在本包范围。当前宿主：{system.Architecture} / {system.Version}，进程：{system.ProcessArchitecture}。此条件不能通过安装前置修复。");
	}

	private FileStream ValidatePackage(PrerequisiteSystem system, CancellationToken cancellationToken)
	{
		PrerequisitePackage prerequisitePackage = hooks.Package(system);
		if (prerequisitePackage.Architecture != system.RuntimeArchitecture)
		{
			throw new InvalidDataException("前置安装器架构与 Windows 宿主架构不一致。");
		}
		string path = storage.RootPath("prerequisites");
		string path2 = storage.RootPath(Path.Combine("prerequisites", prerequisitePackage.ManifestFileName));
		string text = storage.RootPath(Path.Combine("prerequisites", prerequisitePackage.FileName));
		if (!Directory.Exists(path) || !File.Exists(path2) || !File.Exists(text))
		{
			throw new FileNotFoundException("未找到随包 prerequisites 安装文件或 manifest.json。");
		}
		using (FileStream fileStream = new FileStream(path2, FileMode.Open, FileAccess.Read, FileShare.Read))
		{
			if (fileStream.Length > 65536)
			{
				throw new InvalidDataException("前置清单过大。");
			}
			using JsonDocument jsonDocument = JsonDocument.Parse(fileStream);
			JsonElement rootElement = jsonDocument.RootElement;
			if (rootElement.GetProperty("file").GetString() != prerequisitePackage.FileName || rootElement.GetProperty("bytes").GetInt64() != prerequisitePackage.Bytes || !string.Equals(rootElement.GetProperty("sha256").GetString(), prerequisitePackage.Sha256, StringComparison.OrdinalIgnoreCase) || rootElement.GetProperty("version").GetString() != prerequisitePackage.Version || rootElement.GetProperty("source").GetString() != prerequisitePackage.Source || !rootElement.GetProperty("offline").GetBoolean() || rootElement.GetProperty("architecture").GetString() != prerequisitePackage.Architecture || !string.Equals(rootElement.GetProperty("signerThumbprint").GetString(), prerequisitePackage.SignerThumbprint, StringComparison.OrdinalIgnoreCase))
			{
				throw new InvalidDataException("前置清单与本客户端内置校验信息不一致。");
			}
		}
		if (prerequisitePackage.IsOfficial)
		{
			ReadLicenseText();
		}
		storage.ValidatePath(text);
		FileStream fileStream2 = new FileStream(text, FileMode.Open, FileAccess.Read, FileShare.Read);
		try
		{
			storage.ValidatePath(text);
			if (fileStream2.Length != prerequisitePackage.Bytes)
			{
				throw new InvalidDataException("离线安装包大小不符；不能使用联网引导程序代替。");
			}
			cancellationToken.ThrowIfCancellationRequested();
			if (!Convert.ToHexString(SHA256.HashData(fileStream2)).Equals(prerequisitePackage.Sha256, StringComparison.OrdinalIgnoreCase))
			{
				throw new InvalidDataException("离线安装包 SHA256 不符。");
			}
			cancellationToken.ThrowIfCancellationRequested();
			PrerequisiteSignature prerequisiteSignature = hooks.Signature(text);
			if (!prerequisiteSignature.Valid || prerequisiteSignature.Signer != "Microsoft Corporation" || !prerequisiteSignature.Thumbprint.Equals(prerequisitePackage.SignerThumbprint, StringComparison.OrdinalIgnoreCase))
			{
				throw new CryptographicException("未通过微软数字签名验证。" + prerequisiteSignature.Failure);
			}
			string fileVersion = FileVersionInfo.GetVersionInfo(text).FileVersion;
			if (prerequisitePackage.IsOfficial && fileVersion != prerequisitePackage.Version)
			{
				throw new InvalidDataException("微软安装器文件版本不符。");
			}
			return fileStream2;
		}
		catch
		{
			fileStream2.Dispose();
			throw;
		}
	}

	internal static PrerequisiteSystem ReadSystem()
	{
		bool isLtscOrServer = false;
		if (OperatingSystem.IsWindows())
		{
			using RegistryKey registryKey = Registry.LocalMachine.OpenSubKey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion");
			string text = registryKey?.GetValue("ProductName")?.ToString() ?? "";
			isLtscOrServer = text.Contains("LTSC", StringComparison.OrdinalIgnoreCase) || text.Contains("LTSB", StringComparison.OrdinalIgnoreCase) || text.Contains("Server", StringComparison.OrdinalIgnoreCase);
		}
		return new PrerequisiteSystem(OperatingSystem.IsWindows(), RuntimeInformation.OSArchitecture, Environment.OSVersion.Version, isLtscOrServer, RuntimeInformation.ProcessArchitecture);
	}

	internal static string? ReadRuntimeVersion()
	{
		try
		{
			return CoreWebView2Environment.GetAvailableBrowserVersionString(null, new CoreWebView2EnvironmentOptions
			{
				ReleaseChannels = CoreWebView2ReleaseChannels.Stable
			});
		}
		catch (WebView2RuntimeNotFoundException)
		{
			return null;
		}
	}

	internal static async Task<int> ExecuteInstallerAsync(PrerequisiteInstallerRequest request)
	{
		ProcessStartInfo processStartInfo = new ProcessStartInfo(request.FileName)
		{
			WorkingDirectory = request.WorkingDirectory,
			UseShellExecute = false,
			CreateNoWindow = true
		};
		foreach (string argument in request.Arguments)
		{
			processStartInfo.ArgumentList.Add(argument);
		}
		processStartInfo.Environment["TEMP"] = request.TemporaryDirectory;
		processStartInfo.Environment["TMP"] = request.TemporaryDirectory;
		using Process process = Process.Start(processStartInfo) ?? throw new Win32Exception("无法启动微软前置安装程序。");
		await process.WaitForExitAsync();
		return process.ExitCode;
	}

	private static string FormatExitCode(int code)
	{
		return $"{code} / 0x{code:X8}";
	}
}
