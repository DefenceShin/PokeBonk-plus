using System;
using System.ComponentModel;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;

namespace PokeBonk.Client;

internal sealed class BrowserOptimizationWindow : Window
{
	private readonly StackPanel changes = new StackPanel();

	private readonly TextBlock status = new TextBlock
	{
		TextWrapping = TextWrapping.Wrap,
		FontSize = 13.0
	};

	private readonly Button accept = new Button
	{
		Content = new TextBlock
		{
			Text = "同意并一键优化",
			TextWrapping = TextWrapping.Wrap
		},
		Padding = new Thickness(10.0, 9.0, 10.0, 9.0),
		FontSize = 13.0
	};

	private bool alive = true;

	private bool busy;

	internal BrowserOptimizationWindow(Window owner, Func<Task<JsonObject>> read, Func<JsonObject, Task<JsonObject>> apply)
	{
		BrowserOptimizationWindow browserOptimizationWindow = this;
		base.Owner = owner;
		base.Title = "PokéBonk 旅伴 · 优化浏览器设置";
		base.WindowStartupLocation = WindowStartupLocation.CenterOwner;
		base.ShowInTaskbar = false;
		base.ResizeMode = ResizeMode.CanResize;
		base.FontFamily = new FontFamily("Microsoft YaHei UI");
		Rect workArea = SystemParameters.WorkArea;
		base.Width = Math.Max(300.0, Math.Min(760.0, Math.Min((owner.ActualWidth > 0.0) ? owner.ActualWidth : workArea.Width, workArea.Width) - 32.0));
		base.Height = Math.Max(270.0, Math.Min(680.0, Math.Min((owner.ActualHeight > 0.0) ? owner.ActualHeight : workArea.Height, workArea.Height) - 32.0));
		base.MinWidth = Math.Min(420.0, base.Width);
		base.MinHeight = Math.Min(320.0, base.Height);
		base.Background = new SolidColorBrush(Color.FromRgb(244, 247, 242));
		base.Foreground = new SolidColorBrush(Color.FromRgb(37, 59, 49));
		Grid grid = new Grid
		{
			Margin = new Thickness(18.0)
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
			Children = { (UIElement)new TextBlock
			{
				Text = "让内置浏览器更适合长时间游戏",
				FontSize = 22.0,
				FontWeight = FontWeights.Bold,
				TextWrapping = TextWrapping.Wrap
			} }
		};
		grid.Children.Add(element);
		StackPanel content = new StackPanel
		{
			Children = 
			{
				(UIElement)new TextBlock
				{
					Text = "优化方向接近官方桌面端：正常内存、GPU缓存、后台持续运行。实际性能取决于设备与游戏负载，并非已测得相同帧率。",
					TextWrapping = TextWrapping.Wrap,
					FontSize = 14.0,
					Margin = new Thickness(0.0, 9.0, 0.0, 8.0)
				},
				(UIElement)new TextBlock
				{
					Text = "仅调整本客户端。不会修改电脑或日常浏览器设置，不会自动重启、刷新或中断当前对局。",
					TextWrapping = TextWrapping.Wrap,
					FontSize = 13.0,
					Margin = new Thickness(0.0, 0.0, 0.0, 10.0)
				},
				(UIElement)changes
			}
		};
		ScrollViewer element2 = new ScrollViewer
		{
			Content = content,
			VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
			HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
		};
		Grid.SetRow(element2, 1);
		grid.Children.Add(element2);
		StackPanel stackPanel = new StackPanel
		{
			Margin = new Thickness(0.0, 10.0, 0.0, 0.0)
		};
		stackPanel.Children.Add(new ScrollViewer
		{
			Content = status,
			MaxHeight = 64.0,
			VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
			HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
		});
		UniformGrid uniformGrid = new UniformGrid
		{
			Columns = 2,
			Margin = new Thickness(0.0, 9.0, 0.0, 0.0)
		};
		Button later = new Button
		{
			Content = new TextBlock
			{
				Text = "暂不优化",
				TextWrapping = TextWrapping.Wrap
			},
			FontSize = 13.0,
			Padding = new Thickness(10.0, 9.0, 10.0, 9.0),
			Margin = new Thickness(0.0, 0.0, 10.0, 0.0),
			IsCancel = true
		};
		AutomationProperties.SetAutomationId(later, "BrowserOptimizationLater");
		AutomationProperties.SetAutomationId(accept, "BrowserOptimizationAccept");
		later.Click += delegate
		{
			browserOptimizationWindow.Close();
		};
		uniformGrid.Children.Add(later);
		uniformGrid.Children.Add(accept);
		stackPanel.Children.Add(uniformGrid);
		Grid.SetRow(stackPanel, 2);
		grid.Children.Add(stackPanel);
		base.Content = grid;
		base.Closing += delegate(object? _, CancelEventArgs e)
		{
			if (browserOptimizationWindow.busy)
			{
				e.Cancel = true;
			}
			else
			{
				browserOptimizationWindow.alive = false;
			}
		};
		base.Loaded += async delegate
		{
			browserOptimizationWindow.accept.IsEnabled = false;
			browserOptimizationWindow.status.Text = "正在读取可优化项目…";
			try
			{
				JsonObject report = await read();
				if (browserOptimizationWindow.alive)
				{
					browserOptimizationWindow.Render(report);
					browserOptimizationWindow.accept.IsEnabled = true;
				}
			}
			catch (Exception ex) when (!(ex is OutOfMemoryException))
			{
				if (browserOptimizationWindow.alive)
				{
					browserOptimizationWindow.status.Text = "暂未能读取设置：" + ex.Message + "。可关闭窗口，稍后从底部“优化浏览器设置”重试。";
				}
			}
		};
		accept.Click += async delegate
		{
			if (browserOptimizationWindow.busy || !browserOptimizationWindow.alive)
			{
				return;
			}
			browserOptimizationWindow.busy = true;
			browserOptimizationWindow.accept.IsEnabled = false;
			later.IsEnabled = false;
			browserOptimizationWindow.status.Text = "正在保存优化设置…";
			try
			{
				JsonObject jsonObject = await apply(new JsonObject { ["confirmed"] = true });
				if (browserOptimizationWindow.alive)
				{
					browserOptimizationWindow.Render(jsonObject);
					browserOptimizationWindow.status.Text = "优化配置已成功保存，以后启动不再自动提示。" + ((jsonObject["needsRestart"]?.GetValue<bool>() ?? false) ? "请正常结算后关闭并重新打开客户端，使缓存设置生效。" : "") + "底部入口仍可随时查看。";
					later.Content = "关闭";
				}
			}
			catch (Exception ex) when (!(ex is OutOfMemoryException))
			{
				if (browserOptimizationWindow.alive)
				{
					browserOptimizationWindow.status.Text = "优化未完成：" + ex.Message + "。可重试；本次关闭不会记为已优化。";
					browserOptimizationWindow.accept.IsEnabled = true;
				}
			}
			finally
			{
				browserOptimizationWindow.busy = false;
				later.IsEnabled = true;
			}
		};
	}

	private void Render(JsonObject report)
	{
		changes.Children.Clear();
		foreach (JsonObject item in ((report["changes"] as JsonArray) ?? new JsonArray()).OfType<JsonObject>())
		{
			StackPanel stackPanel = new StackPanel
			{
				Margin = new Thickness(12.0)
			};
			stackPanel.Children.Add(new TextBlock
			{
				Text = (item["label"]?.GetValue<string>() ?? "浏览器设置"),
				FontSize = 15.0,
				FontWeight = FontWeights.SemiBold,
				TextWrapping = TextWrapping.Wrap
			});
			stackPanel.Children.Add(new TextBlock
			{
				Text = (item["description"]?.GetValue<string>() ?? ""),
				FontSize = 13.0,
				TextWrapping = TextWrapping.Wrap,
				Margin = new Thickness(0.0, 5.0, 0.0, 0.0)
			});
			changes.Children.Add(new Border
			{
				Child = stackPanel,
				Background = Brushes.White,
				CornerRadius = new CornerRadius(8.0),
				Margin = new Thickness(0.0, 0.0, 0.0, 8.0)
			});
		}
		status.Text = report["warning"]?.GetValue<string>() + "关闭或暂不优化不会修改设置，下次启动仍会提示。";
	}
}
