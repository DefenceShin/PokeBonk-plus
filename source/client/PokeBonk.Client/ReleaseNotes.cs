using System;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows;
using System.Windows.Controls;

namespace PokeBonk.Client;

internal static class ReleaseNotes
{
	public static string Ensure(PortableStorage storage)
	{
		string text = storage.RootPath("更新日志.txt");
		using Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.changelog.txt") ?? throw new FileNotFoundException("客户端缺少更新日志资源");
		using StreamReader streamReader = new StreamReader(stream, Encoding.UTF8);
		string text2 = streamReader.ReadToEnd();
		if (!File.Exists(text) || File.ReadAllText(text, Encoding.UTF8) != text2)
		{
			File.WriteAllText(text, text2, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
		}
		return text;
	}

	public static void Show(Window? owner, string title, string content)
	{
		TextBox content2 = new TextBox
		{
			Text = content,
			IsReadOnly = true,
			AcceptsReturn = true,
			TextWrapping = TextWrapping.Wrap,
			VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
			HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
			Margin = new Thickness(18.0),
			FontSize = 14.0
		};
		Window window = new Window
		{
			Title = title,
			Width = Math.Min(1000.0, SystemParameters.WorkArea.Width),
			Height = Math.Min(780.0, SystemParameters.WorkArea.Height),
			MinWidth = 500.0,
			MinHeight = 350.0,
			Content = content2,
			WindowStartupLocation = ((owner == null) ? WindowStartupLocation.CenterScreen : WindowStartupLocation.CenterOwner),
			ShowActivated = (owner?.ShowActivated ?? true)
		};
		if (owner != null && owner.IsVisible)
		{
			window.Owner = owner;
		}
		window.Show();
	}
}
