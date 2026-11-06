using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PokeBonk.Client;

internal sealed class PortableMigrationWindow : Window
{
	private PortableMigrationChoice choice;

	private PortableMigrationWindow()
	{
		base.Title = "首次升级 · 确认这个文件夹的用途";
		base.Width = Math.Max(320.0, Math.Min(660.0, SystemParameters.WorkArea.Width - 40.0));
		base.MaxHeight = Math.Max(200.0, SystemParameters.WorkArea.Height - 40.0);
		base.Height = Math.Min(560.0, base.MaxHeight);
		base.ResizeMode = ResizeMode.NoResize;
		base.WindowStartupLocation = WindowStartupLocation.CenterScreen;
		base.Background = new SolidColorBrush(Color.FromRgb(246, 249, 243));
		StackPanel stackPanel = new StackPanel
		{
			Margin = new Thickness(28.0)
		};
		stackPanel.Children.Add(new TextBlock
		{
			Text = "先确认：这是原目录，还是复制出来的新副本？",
			FontSize = 21.0,
			FontWeight = FontWeights.Bold,
			TextWrapping = TextWrapping.Wrap,
			Margin = new Thickness(0.0, 0.0, 0.0, 16.0)
		});
		stackPanel.Children.Add(new TextBlock
		{
			Text = "旧版没有目录身份标记，客户端无法可靠自动区分。请选择真实情况；在你选择前，不会打开游戏、读取登录资料或开始挂机。",
			FontSize = 14.0,
			TextWrapping = TextWrapping.Wrap,
			Margin = new Thickness(0.0, 0.0, 0.0, 16.0)
		});
		Add(stackPanel, "原目录升级／搬移：保留现有游客和登录", "继续使用这个文件夹原有的浏览器与本机资料。仅适用于你确实要保留原身份的目录。", PortableMigrationChoice.KeepExisting);
		Add(stackPanel, "复制出来的新副本：建立独立空间", "旧资料完整归档在当前副本目录内；新空间需重新选择游客或登录，企微推送也需重新配置。", PortableMigrationChoice.NewIndependentSpace);
		Button button = new Button
		{
			Content = "暂不选择，安全退出",
			IsCancel = true,
			Padding = new Thickness(12.0, 7.0, 12.0, 7.0),
			HorizontalAlignment = HorizontalAlignment.Right,
			Margin = new Thickness(0.0, 14.0, 0.0, 0.0)
		};
		button.Click += delegate
		{
			choice = PortableMigrationChoice.Cancel;
			base.DialogResult = false;
		};
		stackPanel.Children.Add(button);
		base.Content = new ScrollViewer
		{
			Content = stackPanel,
			VerticalScrollBarVisibility = ScrollBarVisibility.Auto
		};
	}

	private void Add(Panel panel, string title, string detail, PortableMigrationChoice action)
	{
		StackPanel stackPanel = new StackPanel();
		stackPanel.Children.Add(new TextBlock
		{
			Text = title,
			FontWeight = FontWeights.SemiBold,
			FontSize = 15.0,
			TextWrapping = TextWrapping.Wrap
		});
		stackPanel.Children.Add(new TextBlock
		{
			Text = detail,
			FontSize = 12.0,
			TextWrapping = TextWrapping.Wrap,
			Margin = new Thickness(0.0, 6.0, 0.0, 0.0)
		});
		Button button = new Button
		{
			Content = stackPanel,
			HorizontalContentAlignment = HorizontalAlignment.Left,
			Padding = new Thickness(12.0),
			Margin = new Thickness(0.0, 0.0, 0.0, 10.0)
		};
		button.Click += delegate
		{
			choice = action;
			base.DialogResult = true;
		};
		panel.Children.Add(button);
	}

	internal static PortableMigrationChoice Choose()
	{
		PortableMigrationWindow portableMigrationWindow = new PortableMigrationWindow();
		portableMigrationWindow.ShowDialog();
		return portableMigrationWindow.choice;
	}
}
