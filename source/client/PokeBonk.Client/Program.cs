using System;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Windows;

namespace PokeBonk.Client;

public static class Program
{
	public static string BrowserArguments { get; private set; } = "";

	public static bool BrowserOptimizationEnabledAtLaunch { get; private set; }

	public static bool IndependentSpaceCreatedAtLaunch { get; private set; }

	[STAThread]
	public static void Main(string[] args)
	{
		try
		{
			string fullPath = Path.GetFullPath(AppContext.BaseDirectory);
			ValidateStorageArguments(args);
			using (DistributionInstance.Acquire())
			{
				using (PortableInstance.Acquire(fullPath))
				{
					PortableIsolationInspection portableIsolationInspection = PortableIsolation.Inspect(fullPath);
					PortableMigrationChoice choice = ((!portableIsolationInspection.NeedsChoice) ? PortableMigrationChoice.KeepExisting : PortableMigrationWindow.Choose());
					PortableIsolationResult portableIsolationResult = PortableIsolation.Apply(portableIsolationInspection, choice, MainWindow.PortablePublicSettingsKeys());
					if (!(portableIsolationResult == null))
					{
						IndependentSpaceCreatedAtLaunch = portableIsolationResult.Kind == "isolated-copy";
						PortableStorage portableStorage = new PortableStorage(null, args.Contains("--smoke") ? "smoke" : null);
						portableStorage.ConfigureProcessEnvironment();
						if (IndependentSpaceCreatedAtLaunch)
						{
							portableStorage.Append(new JsonObject
							{
								["level"] = "info",
								["title"] = "复制副本已建立独立空间",
								["detail"] = "旧资料保留在当前目录的archives归档中；请重新选择游客或登录，并重新配置企微接收目标。"
							});
						}
						string cachePath = portableStorage.EnsureDirectory(portableStorage.DataPath("cache"));
						BrowserOptimizationEnabledAtLaunch = new BrowserOptimizationPolicy(portableStorage).Load();
						bool diagnostics = args.Contains("--smoke") || args.Contains("--diagnostics");
						int diagnosticPort = 0;
						BrowserArguments = BrowserOptimizationPolicy.BrowserArguments(cachePath, BrowserOptimizationEnabledAtLaunch, diagnostics, diagnosticPort);
						Environment.SetEnvironmentVariable("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", BrowserArguments, EnvironmentVariableTarget.Process);
						App obj = new App
						{
							Storage = portableStorage
						};
						obj.InitializeComponent();
						obj.Run();
					}
				}
			}
		}
		catch (PublicClientInUseException ex)
		{
			MessageBox.Show(ex.Message, "PokéBonk 旅伴");
			Environment.ExitCode = 1;
		}
		catch (PortableInstanceInUseException ex2)
		{
			MessageBox.Show(ex2.Message, "PokéBonk 旅伴");
			Environment.ExitCode = 1;
		}
		catch (Exception ex3)
		{
			MessageBox.Show("客户端无法启动：" + ex3.Message + "\n请将完整客户端放在可写文件夹中。", "PokéBonk 旅伴");
			Environment.ExitCode = 1;
		}
	}

	internal static void ValidateStorageArguments(string[] args)
	{
		foreach (string text in args)
		{
			bool flag;
			switch (text)
			{
			case "--profile":
			case "--user-data-dir":
			case "--data-dir":
			case "--browser-data-folder":
				flag = true;
				break;
			default:
				flag = false;
				break;
			}
			if (flag || new string[4] { "--profile=", "--user-data-dir=", "--data-dir=", "--browser-data-folder=" }.Any(text.StartsWith))
			{
				throw new ArgumentException("客户端数据固定保存在EXE同目录，不接受外部数据目录或额外配置分区参数。");
			}
			if (text.StartsWith("--diagnostics-port=", StringComparison.Ordinal) && text != "--diagnostics-port=0")
			{
				throw new ArgumentException("诊断端口由本客户端自动分配，不接受固定共享端口。");
			}
		}
	}
}
