using System;
using System.ComponentModel;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace PokeBonk.Client;

public sealed class PrerequisiteWindow : Window
{
	private readonly PrerequisiteService service;

	private readonly Action continueStartup;

	private readonly Action<string, string>? log;

	private readonly TextBlock status = new TextBlock
	{
		TextWrapping = TextWrapping.Wrap,
		FontSize = 17.0,
		Foreground = Brush("#234D3F")
	};

	private readonly TextBlock detail = new TextBlock
	{
		TextWrapping = TextWrapping.Wrap,
		FontSize = 13.0,
		Foreground = Brush("#65736D"),
		Margin = new Thickness(0.0, 12.0, 0.0, 0.0)
	};

	private readonly TextBlock progress = new TextBlock
	{
		TextWrapping = TextWrapping.Wrap,
		Foreground = Brush("#3E765F"),
		Margin = new Thickness(0.0, 20.0, 0.0, 0.0)
	};

	private readonly Button install = Button("下载前置", primary: true);

	private readonly Button check = Button("重新检查");

	private readonly ProgressBar activity = new ProgressBar
	{
		Height = 4.0,
		IsIndeterminate = false,
		Margin = new Thickness(0.0, 18.0, 0.0, 0.0),
		Visibility = Visibility.Collapsed
	};

	private bool continued;

	public PrerequisiteWindow(PrerequisiteService service, Action continueStartup, Action? showUpdateLog = null, Action<string, string>? log = null)
	{
		PrerequisiteWindow prerequisiteWindow = this;
		this.service = service;
		this.continueStartup = continueStartup;
		this.log = log;
		base.Title = "PokéBonk 旅伴 · 运行前置";
		base.Width = 900.0;
		base.Height = 600.0;
		base.MinWidth = 760.0;
		base.MinHeight = 540.0;
		base.WindowStartupLocation = WindowStartupLocation.CenterScreen;
		base.Background = Brush("#F4F7F2");
		base.Foreground = Brush("#253B31");
		base.FontFamily = new FontFamily("Microsoft YaHei UI");
		Grid grid = new Grid
		{
			Margin = new Thickness(32.0)
		};
		grid.RowDefinitions.Add(new RowDefinition
		{
			Height = GridLength.Auto
		});
		grid.RowDefinitions.Add(new RowDefinition
		{
			Height = new GridLength(1.0, GridUnitType.Star)
		});
		grid.RowDefinitions.Add(new RowDefinition
		{
			Height = GridLength.Auto
		});
		StackPanel element = new StackPanel
		{
			Children = 
			{
				(UIElement)new TextBlock
				{
					Text = "POKÉBONK  旅伴",
					FontSize = 25.0,
					FontWeight = FontWeights.Bold
				},
				(UIElement)new TextBlock
				{
					Text = "一次准备，之后直接开始冒险",
					FontSize = 14.0,
					Foreground = Brush("#6B7D72"),
					Margin = new Thickness(0.0, 8.0, 0.0, 24.0)
				}
			}
		};
		grid.Children.Add(element);
		Border border = new Border
		{
			Background = Brushes.White,
			CornerRadius = new CornerRadius(16.0),
			Padding = new Thickness(26.0),
			BorderBrush = Brush("#DBE6DA"),
			BorderThickness = new Thickness(1.0)
		};
		border.Child = new StackPanel
		{
			Children = 
			{
				(UIElement)status,
				(UIElement)detail,
				(UIElement)progress,
				(UIElement)activity,
				(UIElement)new TextBlock
				{
					Text = "客户端已包含 .NET。运行游戏窗口只需 Microsoft Edge WebView2 Runtime，无需另外安装 Node.js、SDK 或浏览器。\n“下载前置”会使用 EXE 旁 prerequisites 中的微软完整离线包进行安装，不会临时联网寻找安装包。",
					TextWrapping = TextWrapping.Wrap,
					Margin = new Thickness(0.0, 22.0, 0.0, 0.0),
					FontSize = 13.0,
					LineHeight = 23.0,
					Foreground = Brush("#65736D")
				}
			}
		};
		Grid.SetRow(border, 1);
		grid.Children.Add(border);
		StackPanel stackPanel = new StackPanel
		{
			Margin = new Thickness(0.0, 20.0, 0.0, 0.0)
		};
		stackPanel.Children.Add(new TextBlock
		{
			Text = "点击“下载前置”即表示同意微软许可条款。WebView2 含 Microsoft Defender SmartScreen，可能依微软隐私声明收集并向微软发送信息，且 Runtime 会自动更新。",
			TextWrapping = TextWrapping.Wrap,
			FontSize = 11.0,
			Foreground = Brush("#718077"),
			Margin = new Thickness(0.0, 0.0, 0.0, 12.0)
		});
		DockPanel dockPanel = new DockPanel
		{
			LastChildFill = false
		};
		Button button = Button("微软许可与隐私");
		button.Click += delegate
		{
			prerequisiteWindow.ShowLicense();
		};
		DockPanel.SetDock(button, Dock.Left);
		dockPanel.Children.Add(button);
		AutomationProperties.SetAutomationId(install, "DownloadPrerequisites");
		install.Click += async delegate
		{
			await prerequisiteWindow.InstallAsync();
		};
		DockPanel.SetDock(install, Dock.Right);
		dockPanel.Children.Add(install);
		Button button2 = Button("更新日志");
		button2.Click += delegate
		{
			if (showUpdateLog != null)
			{
				showUpdateLog();
			}
			else
			{
				prerequisiteWindow.ShowText("更新日志", "本版本增加内置微软 WebView2 离线前置检测与安装。\n前置缺失时也能显示原生引导窗口；安装完成后重新检测，再打开游戏窗口。");
			}
		};
		DockPanel.SetDock(button2, Dock.Right);
		dockPanel.Children.Add(button2);
		check.Click += async delegate
		{
			await prerequisiteWindow.InspectAsync();
		};
		DockPanel.SetDock(check, Dock.Right);
		dockPanel.Children.Add(check);
		stackPanel.Children.Add(dockPanel);
		Grid.SetRow(stackPanel, 2);
		grid.Children.Add(stackPanel);
		base.Content = grid;
		service.Changed += OnChanged;
		base.Loaded += async delegate
		{
			prerequisiteWindow.Render(service.Current);
			if (service.Current.Status == "checking")
			{
				await prerequisiteWindow.InspectAsync();
			}
		};
		base.Closed += delegate
		{
			service.Changed -= prerequisiteWindow.OnChanged;
		};
		base.Closing += delegate(object? _, CancelEventArgs args)
		{
			if (service.IsInstalling)
			{
				args.Cancel = true;
				prerequisiteWindow.progress.Text = "微软安装程序仍在运行，请等待完成后关闭。客户端不会强制终止系统安装进程。";
			}
		};
	}

	private async Task InspectAsync()
	{
		check.IsEnabled = false;
		install.IsEnabled = false;
		try
		{
			await service.InspectAsync();
			Render(service.Current);
		}
		catch (Exception ex)
		{
			status.Text = "前置检查失败";
			detail.Text = ex.Message;
		}
		finally
		{
			check.IsEnabled = !service.IsInstalling;
		}
	}

	private async Task InstallAsync()
	{
		install.IsEnabled = false;
		check.IsEnabled = false;
		try
		{
			TryLog("info", "开始安装前置：按 Windows 宿主架构选择随客户端提供的微软 WebView2 完整离线安装包。");
			PrerequisiteSnapshot prerequisiteSnapshot = await service.InstallMissingAsync();
			Render(prerequisiteSnapshot);
			TryLog(prerequisiteSnapshot.Ready ? "info" : "warning", (prerequisiteSnapshot.Ready ? "前置已可用：" : "前置安装未完成：") + prerequisiteSnapshot.Reason);
		}
		catch (Exception ex)
		{
			status.Text = "安装未完成，可重试";
			detail.Text = ex.Message;
		}
		finally
		{
			check.IsEnabled = !service.IsInstalling;
		}
	}

	private void TryLog(string title, string message)
	{
		try
		{
			log?.Invoke(title, message);
		}
		catch
		{
		}
	}

	private void OnChanged(PrerequisiteSnapshot state)
	{
		if (base.Dispatcher.CheckAccess())
		{
			Render(service.Current);
		}
		else if (!base.Dispatcher.HasShutdownStarted)
		{
			base.Dispatcher.BeginInvoke((Action)delegate
			{
				Render(service.Current);
			});
		}
	}

	private void Render(PrerequisiteSnapshot state)
	{
		TextBlock textBlock = status;
		textBlock.Text = state.Status switch
		{
			"ready" => "运行前置已准备好", 
			"unsupported" => "当前系统不适合此安装包", 
			"invalid-package" => "请重新解压完整版客户端", 
			"installing" => "正在安装运行前置", 
			"verifying" => "正在确认安装结果", 
			"restart-required" => "请重启 Windows 后再检查", 
			"error" => "前置暂未准备完成", 
			"missing" => "还差一个运行前置", 
			"outdated" => "浏览器组件需要升级", 
			_ => "正在检查运行前置", 
		};
		detail.Text = state.Reason;
		progress.Text = state.Progress;
		install.IsEnabled = state.CanInstall;
		check.IsEnabled = !service.IsInstalling;
		ProgressBar progressBar = activity;
		bool isIndeterminate;
		switch (state.Status)
		{
		case "checking":
		case "installing":
		case "verifying":
			isIndeterminate = true;
			break;
		default:
			isIndeterminate = false;
			break;
		}
		progressBar.IsIndeterminate = isIndeterminate;
		activity.Visibility = ((!activity.IsIndeterminate) ? Visibility.Collapsed : Visibility.Visible);
		if (state.Ready && !continued)
		{
			continued = true;
			base.Dispatcher.BeginInvoke((Action)delegate
			{
				continueStartup();
			});
		}
	}

	private void ShowLicense()
	{
		try
		{
			string text = service.ReadLicenseText();
			ShowText("微软 WebView2 许可与隐私", text + "\n\n微软隐私声明：https://aka.ms/privacy\nSmartScreen 说明：https://learn.microsoft.com/en-us/microsoft-edge/privacy-whitepaper#smartscreen\n安装程序由 Microsoft 提供；本客户端不代表 Microsoft。");
		}
		catch (Exception ex)
		{
			ShowText("微软许可文件不可用", "请重新解压完整客户端以查看随包许可文本。\n" + ex.Message);
		}
	}

	private void ShowText(string title, string text)
	{
		Window window = new Window();
		window.Owner = this;
		window.Title = title;
		window.Width = 740.0;
		window.Height = 560.0;
		window.WindowStartupLocation = WindowStartupLocation.CenterOwner;
		window.Content = new TextBox
		{
			Text = text,
			IsReadOnly = true,
			TextWrapping = TextWrapping.Wrap,
			VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
			Padding = new Thickness(18.0),
			FontFamily = base.FontFamily,
			FontSize = 13.0,
			BorderThickness = new Thickness(0.0)
		};
		window.ShowDialog();
	}

	private static SolidColorBrush Brush(string color)
	{
		return new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));
	}

	private static Button Button(string text, bool primary = false)
	{
		return new Button
		{
			Content = text,
			Padding = new Thickness(17.0, 10.0, 17.0, 10.0),
			Margin = new Thickness(4.0, 0.0, 0.0, 0.0),
			FontSize = 13.0,
			Background = (primary ? Brush("#487F65") : Brushes.White),
			Foreground = (primary ? Brushes.White : Brush("#426653")),
			BorderBrush = Brush("#D4DFD1"),
			BorderThickness = new Thickness(1.0),
			Cursor = Cursors.Hand
		};
	}
}
