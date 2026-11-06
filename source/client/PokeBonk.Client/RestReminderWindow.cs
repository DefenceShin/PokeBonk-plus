using System;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace PokeBonk.Client;

internal sealed class RestReminderWindow : Window
{
	internal const string ReminderMessage = "你已不间断挂机五小时，请短暂休息并自己操作一会再继续，否则被检测风险极大。";

	private readonly RestReminderCountdown countdown = new RestReminderCountdown();

	private readonly DispatcherTimer clock = new DispatcherTimer
	{
		Interval = TimeSpan.FromSeconds(1.0)
	};

	private readonly TextBlock remaining = new TextBlock
	{
		FontSize = 22.0,
		FontWeight = FontWeights.SemiBold,
		TextAlignment = TextAlignment.Center,
		Margin = new Thickness(0.0, 20.0, 0.0, 16.0)
	};

	private readonly Func<bool> current;

	private readonly Action acknowledge;

	private bool suppressAcknowledgement;

	private bool acknowledged;

	private static double NowMilliseconds => (double)Stopwatch.GetTimestamp() * 1000.0 / (double)Stopwatch.Frequency;

	internal RestReminderWindow(RestReminderState state, Func<bool> current, Action acknowledge)
	{
		RestReminderWindow restReminderWindow = this;
		this.current = current;
		this.acknowledge = acknowledge;
		base.Title = "PokéBonk 旅伴 · 休息提醒";
		base.Width = Math.Max(300.0, Math.Min(560.0, SystemParameters.WorkArea.Width - 32.0));
		base.MaxHeight = Math.Max(220.0, SystemParameters.WorkArea.Height - 32.0);
		base.SizeToContent = SizeToContent.Height;
		base.ResizeMode = ResizeMode.NoResize;
		base.WindowStartupLocation = WindowStartupLocation.CenterOwner;
		base.Background = new SolidColorBrush(Color.FromRgb(246, 249, 243));
		base.Foreground = new SolidColorBrush(Color.FromRgb(35, 61, 49));
		base.FontFamily = new FontFamily("Microsoft YaHei UI");
		StackPanel stackPanel = new StackPanel
		{
			Margin = new Thickness(28.0)
		};
		stackPanel.Children.Add(new TextBlock
		{
			Text = "你已不间断挂机五小时，请短暂休息并自己操作一会再继续，否则被检测风险极大。",
			FontSize = 17.0,
			TextWrapping = TextWrapping.Wrap,
			LineHeight = 28.0
		});
		stackPanel.Children.Add(remaining);
		stackPanel.Children.Add(new TextBlock
		{
			Text = "倒计时结束后自动关闭并继续；也可点击“我知道了”或关闭此窗口提前继续。",
			FontSize = 12.0,
			TextWrapping = TextWrapping.Wrap,
			Margin = new Thickness(0.0, 0.0, 0.0, 18.0)
		});
		Button button = new Button
		{
			Content = "我知道了",
			Padding = new Thickness(22.0, 9.0, 22.0, 9.0),
			HorizontalAlignment = HorizontalAlignment.Right,
			FontSize = 14.0
		};
		button.Click += delegate
		{
			restReminderWindow.Close();
		};
		stackPanel.Children.Add(button);
		base.Content = new ScrollViewer
		{
			Content = stackPanel,
			VerticalScrollBarVisibility = ScrollBarVisibility.Auto
		};
		clock.Tick += delegate
		{
			restReminderWindow.Refresh();
		};
		base.Closed += delegate
		{
			restReminderWindow.clock.Stop();
			if (!restReminderWindow.suppressAcknowledgement && !restReminderWindow.acknowledged && current())
			{
				restReminderWindow.acknowledged = true;
				acknowledge();
			}
		};
		countdown.Observe(state.RemainingMilliseconds, NowMilliseconds);
		base.Loaded += delegate
		{
			restReminderWindow.Refresh();
			if (restReminderWindow.IsVisible)
			{
				restReminderWindow.clock.Start();
			}
		};
	}

	internal void Observe(double remainingMilliseconds)
	{
		countdown.Observe(remainingMilliseconds, NowMilliseconds);
		Refresh();
	}

	private void Refresh()
	{
		if (!current())
		{
			CloseWithoutAcknowledgement();
			return;
		}
		double num = countdown.Remaining(NowMilliseconds);
		remaining.Text = RestReminderCountdown.Display(num) + " 后窗口自动关闭";
		if (num <= 0.0)
		{
			Close();
		}
	}

	internal void CloseWithoutAcknowledgement()
	{
		suppressAcknowledgement = true;
		clock.Stop();
		Close();
	}
}
