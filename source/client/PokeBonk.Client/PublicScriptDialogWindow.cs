using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PokeBonk.Client;

internal sealed class PublicScriptDialogWindow : Window
{
	private readonly Action<bool, string> finish;

	private readonly TextBox answer;

	private bool completed;

	internal PublicScriptDialogWindow(Window owner, string message, string initial, bool prompt, bool alert, bool unloading, Action<bool, string> finish)
	{
		this.finish = finish;
		base.Owner = owner;
		base.Title = (unloading ? "游戏页面确认" : "游戏提示");
		base.Width = 480.0;
		base.MinWidth = 300.0;
		base.MaxHeight = 620.0;
		base.SizeToContent = SizeToContent.Height;
		base.WindowStartupLocation = WindowStartupLocation.CenterOwner;
		base.ShowInTaskbar = false;
		StackPanel stackPanel = new StackPanel
		{
			Margin = new Thickness(22.0)
		};
		stackPanel.Children.Add(new TextBox
		{
			Text = message,
			IsReadOnly = true,
			TextWrapping = TextWrapping.Wrap,
			BorderThickness = new Thickness(0.0),
			Background = Brushes.Transparent,
			MaxHeight = 350.0,
			VerticalScrollBarVisibility = ScrollBarVisibility.Auto
		});
		answer = new TextBox
		{
			Text = initial,
			Margin = new Thickness(0.0, 14.0, 0.0, 0.0),
			Visibility = ((!prompt) ? Visibility.Collapsed : Visibility.Visible)
		};
		stackPanel.Children.Add(answer);
		StackPanel stackPanel2 = new StackPanel
		{
			Orientation = Orientation.Horizontal,
			HorizontalAlignment = HorizontalAlignment.Right,
			Margin = new Thickness(0.0, 18.0, 0.0, 0.0)
		};
		if (!alert)
		{
			Button button = new Button
			{
				Content = "取消",
				MinWidth = 85.0,
				Margin = new Thickness(0.0, 0.0, 10.0, 0.0)
			};
			button.Click += delegate
			{
				Finish(accepted: false);
			};
			stackPanel2.Children.Add(button);
		}
		Button button2 = new Button
		{
			Content = (unloading ? "确认离开 / 重新加载" : "确定"),
			MinWidth = 95.0
		};
		button2.Click += delegate
		{
			Finish(accepted: true);
		};
		stackPanel2.Children.Add(button2);
		stackPanel.Children.Add(stackPanel2);
		base.Content = stackPanel;
		base.Closed += delegate
		{
			Complete(accepted: false);
		};
	}

	private void Complete(bool accepted)
	{
		if (!completed)
		{
			completed = true;
			finish(accepted, answer.Text);
		}
	}

	private void Finish(bool accepted)
	{
		Complete(accepted);
		Close();
	}

	internal void CancelOwned()
	{
		Complete(accepted: false);
		Close();
	}
}
