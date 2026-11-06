using System;
using System.CodeDom.Compiler;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Threading;

namespace PokeBonk.Client;

public class App : Application
{
	private bool _contentLoaded;

	public PortableStorage Storage { get; init; }

	protected override async void OnStartup(StartupEventArgs e)
	{
		base.OnStartup(e);
		base.DispatcherUnhandledException += async delegate(object _, DispatcherUnhandledExceptionEventArgs args)
		{
			args.Handled = true;
			bool flag = false;
			try
			{
				Storage.Append(new JsonObject
				{
					["at"] = DateTimeOffset.Now.ToString("O"),
					["level"] = "error",
					["type"] = "error",
					["title"] = "客户端异常",
					["detail"] = args.Exception.GetType().FullName + "\n" + args.Exception.StackTrace
				});
				flag = true;
			}
			catch
			{
			}
			if (base.MainWindow is MainWindow mainWindow)
			{
				await mainWindow.HandleUnexpectedClientFailureAsync(args.Exception, flag);
			}
			else
			{
				MessageBox.Show((flag ? "客户端遇到问题，详情已记录在程序旁的挂机日志.txt。\n" : "客户端遇到问题，且程序目录无法写入。\n") + args.Exception.Message, "PokéBonk Pilot");
				if (base.MainWindow == null)
				{
					Shutdown(1);
				}
			}
		};
		base.ShutdownMode = ShutdownMode.OnExplicitShutdown;
		try
		{
			ReleaseNotes.Ensure(Storage);
			PrerequisiteService prerequisites = new PrerequisiteService(Storage);
			if ((await prerequisites.InspectAsync()).Ready)
			{
				OpenClient(e.Args, prerequisites);
			}
			else
			{
				ShowPrerequisites(e.Args, prerequisites);
			}
		}
		catch (Exception ex)
		{
			MessageBox.Show("启动检查未完成：" + ex.Message + "\n请将完整客户端解压到可写文件夹后重试。", "PokéBonk 旅伴");
			Shutdown(1);
		}
	}

	private void OpenClient(string[] args, PrerequisiteService prerequisites)
	{
		Window mainWindow = base.MainWindow;
		MainWindow mainWindow2 = new MainWindow(args, Storage, prerequisites);
		if (args.Contains("--diagnostics-no-activate") && (args.Contains("--diagnostics") || args.Contains("--smoke")))
		{
			mainWindow2.ShowActivated = false;
		}
		base.MainWindow = mainWindow2;
		mainWindow2.Show();
		mainWindow?.Close();
		base.ShutdownMode = ShutdownMode.OnMainWindowClose;
	}

	internal void ShowPrerequisites(string[] args, PrerequisiteService prerequisites)
	{
		Window mainWindow = base.MainWindow;
		base.ShutdownMode = ShutdownMode.OnExplicitShutdown;
		PrerequisiteWindow fallback = new PrerequisiteWindow(prerequisites, delegate
		{
			OpenClient(args, prerequisites);
		}, delegate
		{
			ReleaseNotes.Show(base.MainWindow, "更新日志", File.ReadAllText(ReleaseNotes.Ensure(Storage)));
		}, delegate(string level, string message)
		{
			Storage.Append(new JsonObject
			{
				["at"] = DateTimeOffset.Now.ToString("O"),
				["type"] = level,
				["title"] = "前置检查",
				["detail"] = message
			});
		});
		base.MainWindow = fallback;
		fallback.Closed += delegate
		{
			if (base.MainWindow == fallback)
			{
				Shutdown();
			}
		};
		fallback.Show();
		if (mainWindow is MainWindow mainWindow2)
		{
			mainWindow2.CloseForPrerequisiteRecovery();
		}
	}

	[DebuggerNonUserCode]
	[GeneratedCode("PresentationBuildTasks", "10.0.9.0")]
	public void InitializeComponent()
	{
		if (!_contentLoaded)
		{
			_contentLoaded = true;
			Uri resourceLocator = new Uri("/PokeBonk Pilot;component/app.xaml", UriKind.Relative);
			Application.LoadComponent(this, resourceLocator);
		}
	}

	[STAThread]
	[DebuggerNonUserCode]
	[GeneratedCode("PresentationBuildTasks", "10.0.9.0")]
	public static void Main()
	{
		App app = new App();
		app.InitializeComponent();
		app.Run();
	}
}
