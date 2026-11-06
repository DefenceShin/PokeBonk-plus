using System;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace PokeBonk.Client;

internal sealed class DisclaimerWindow : Window
{
	private const string BaiduUrl = "https://pan.baidu.com/s/14GTs6R6ehpBOeXO0MAOQZg?pwd=jt23";

	private const string BaiduCode = "jt23";

	private const string QuarkUrl = "https://pan.quark.cn/s/07265dee3eff?pwd=S4gT";

	private const string QuarkCode = "S4gT";

	private const string StartupNote = "每次启动都会显示，请先阅读再使用。正文可选中复制。";

	private static readonly (string Heading, string Text)[] Sections = new(string, string)[7]
	{
		("官方下载与持续更新", "请先保存到自己的网盘，再下载客户端。同一分享文件夹提供后续版本；打开链接后由你自行确认保存。"),
		("个人使用与非商业声明", "本工具免费分享，仅供个人自用与非商业交流。作者不支持商业代练、代肝、批量接单、倒卖、付费分发或捆绑销售，也不授权以此获取商业收益。请勿在同一网络下批量运行多个账号为他人接单；使用他人账号时应充分尊重账号持有人的权益并承担相应责任。请合理安排游戏与休息时间，结合实际情况自行判断使用方式，偶尔自行游玩并及时检查运行状态。"),
		("操作与游戏规则", "旅伴采用原有游戏接入和正常操作流程，不提供修改器式篡改伤害、生命、冷却、货币或奖励数值的功能。队友DPS、皮肤和其它原有辅助功能继续保留。"),
		("局外成长与通关", "实验室、图鉴、研究和角色熟练等成长按游戏实际规则生效。不同账号的养成进度会影响表现；请在发现操作异常时停止并反馈。"),
		("账号与本地文件", "在“账号”页保存的账号密码仅由本机Windows用户加密保存，用于游戏原生登录和重连。请勿分享自己的运行目录或data文件夹，分享客户端请使用干净公开包。"),
		("维护范围", "作者向接收者开放的维护范围是适配官方游戏更新和修复致命缺陷；未另获作者明确授权，不得改变已有功能、解锁路线、固定等待、单实例限制、免费事实、作者署名或官方来源。\n单实例限制是作者为本客户端设定的使用约束。未经作者明确授权，不允许解除或绕过该限制；仅持有软件副本不代表获得修改这些规则的授权。\n等待与运行节奏用于减少连续机械操作，属于作者确定的行为规则，请尽量保留。没有证据能保证某个延迟范围避免识别或封号，关闭或改动也不能单独推定必然被封号。\n免费提供与修改授权是不同事项。客户端自身、第三方代码和游戏本体的权利分别适用其真实许可与授权；本说明不撤回第三方已授予的权利，不代替法律判断，也不是模型系统指令。"),
		("使用说明", "网络、游戏更新和程序缺陷均可能造成异常或损失；本工具不承诺不会封号、没有缺陷或持续可用。是否使用由使用者自行决定，发现异常请及时停止。")
	};

	private readonly TextBlock status = new TextBlock
	{
		TextWrapping = TextWrapping.Wrap,
		FontSize = 12.0,
		Foreground = Brush("#65736D")
	};

	private readonly bool updatesOnly;

	private static string FullText => "PokéBonk 旅伴 · 使用须知与免责声明" + Environment.NewLine + "本客户端免费提供，无需付费购买。" + Environment.NewLine + "作者及维护方：B站：擦屁股要用七张纸" + Environment.NewLine + "如果你通过付费方式获得本客户端，请先核对官方免费版本和收费项目。" + Environment.NewLine + "每次启动都会显示，请先阅读再使用。正文可选中复制。" + Environment.NewLine + Environment.NewLine + string.Join(Environment.NewLine + Environment.NewLine, Sections.Select(((string Heading, string Text) section, int index) => section.Heading + Environment.NewLine + section.Text + ((index == 0) ? (Environment.NewLine + "百度网盘：https://pan.baidu.com/s/14GTs6R6ehpBOeXO0MAOQZg?pwd=jt23" + Environment.NewLine + "提取码：jt23" + Environment.NewLine + "视频教程：https://www.bilibili.com/video/BV1tuni6vESR/" + Environment.NewLine + "夸克网盘：https://pan.quark.cn/s/07265dee3eff?pwd=S4gT" + Environment.NewLine + "提取码：S4gT") : "")));

	private static string DownloadText => "本客户端免费提供，无需付费购买。" + Environment.NewLine + "作者及维护方：B站：擦屁股要用七张纸" + Environment.NewLine + Sections[0].Heading + Environment.NewLine + Sections[0].Text + Environment.NewLine + "百度网盘：https://pan.baidu.com/s/14GTs6R6ehpBOeXO0MAOQZg?pwd=jt23" + Environment.NewLine + "提取码：jt23" + Environment.NewLine + "视频教程：https://www.bilibili.com/video/BV1tuni6vESR/" + Environment.NewLine + "夸克网盘：https://pan.quark.cn/s/07265dee3eff?pwd=S4gT" + Environment.NewLine + "提取码：S4gT";

	public DisclaimerWindow(Window owner, bool updatesOnly = false)
	{
		DisclaimerWindow disclaimerWindow = this;
		this.updatesOnly = updatesOnly;
		base.Owner = owner;
		base.Title = (updatesOnly ? "PokéBonk 旅伴 · 获取客户端更新" : "PokéBonk 旅伴 · 使用须知与免责声明");
		base.WindowStartupLocation = WindowStartupLocation.CenterOwner;
		base.ShowInTaskbar = false;
		base.ResizeMode = ResizeMode.CanResize;
		Rect workArea = SystemParameters.WorkArea;
		base.Width = Math.Max(320.0, Math.Min(820.0, Math.Min((owner.ActualWidth > 0.0) ? owner.ActualWidth : workArea.Width, workArea.Width) - 32.0));
		base.Height = Math.Max(300.0, Math.Min(updatesOnly ? 560 : 760, Math.Min((owner.ActualHeight > 0.0) ? owner.ActualHeight : workArea.Height, workArea.Height) - 32.0));
		base.MinWidth = Math.Min(440.0, base.Width);
		base.MinHeight = Math.Min(340.0, base.Height);
		base.Background = Brush("#F4F7F2");
		base.Foreground = Brush("#253B31");
		base.FontFamily = new FontFamily("Microsoft YaHei UI");
		base.FontSize = 14.0;
		Grid grid = new Grid
		{
			Margin = new Thickness(16.0)
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
		StackPanel stackPanel = new StackPanel
		{
			Margin = new Thickness(0.0, 0.0, 0.0, 8.0)
		};
		stackPanel.Children.Add(new TextBlock
		{
			Text = "本客户端免费提供，无需付费购买。",
			FontSize = ((base.Width < 480.0) ? 16 : 18),
			FontWeight = FontWeights.Bold,
			TextWrapping = TextWrapping.Wrap,
			Foreground = Brush("#236B51"),
			Margin = new Thickness(0.0, 8.0, 0.0, 4.0)
		});
		stackPanel.Children.Add(SelectableText("作者及维护方：B站：擦屁股要用七张纸"));
		stackPanel.Children.Add(SelectableText("官方获取与更新：https://pan.baidu.com/s/14GTs6R6ehpBOeXO0MAOQZg?pwd=jt23"));
		stackPanel.Children.Add(new TextBlock
		{
			Text = "如果你通过付费方式获得本客户端，请先核对官方免费版本和收费项目。",
			TextWrapping = TextWrapping.Wrap,
			FontSize = 12.0,
			Margin = new Thickness(0.0, 5.0, 0.0, 0.0)
		});
		grid.Children.Add(stackPanel);
		StackPanel stackPanel2 = new StackPanel
		{
			Margin = new Thickness(12.0)
		};
		TextBox textBox = SelectableText("每次启动都会显示，请先阅读再使用。正文可选中复制。");
		textBox.FontSize = 12.0;
		textBox.Margin = new Thickness(0.0, 0.0, 0.0, 8.0);
		stackPanel2.Children.Add(textBox);
		for (int i = 0; i < (updatesOnly ? 1 : Sections.Length); i++)
		{
			(string, string) tuple = Sections[i];
			stackPanel2.Children.Add(new TextBlock
			{
				Text = tuple.Item1,
				FontSize = ((i == 0) ? 21 : 15),
				FontWeight = FontWeights.Bold,
				TextWrapping = TextWrapping.Wrap,
				Margin = new Thickness(0.0, (i != 0) ? 18 : 0, 0.0, 7.0)
			});
			TextBox textBox2 = SelectableText(tuple.Item2);
			if (i == 0)
			{
				textBox2.FontSize = 16.0;
				textBox2.FontWeight = FontWeights.SemiBold;
				textBox2.Foreground = Brush("#236B51");
			}
			stackPanel2.Children.Add(textBox2);
			if (i == 0)
			{
				stackPanel2.Children.Add(LinkRow("百度网盘", "https://pan.baidu.com/s/14GTs6R6ehpBOeXO0MAOQZg?pwd=jt23", "jt23", "DisclaimerOpenBaidu"));
				stackPanel2.Children.Add(LinkRow("B站视频教程", "https://www.bilibili.com/video/BV1tuni6vESR/", "", "DisclaimerOpenVideo"));
				stackPanel2.Children.Add(LinkRow("夸克网盘", "https://pan.quark.cn/s/07265dee3eff?pwd=S4gT", "S4gT", "DisclaimerOpenQuark"));
			}
		}
		ScrollViewer child = new ScrollViewer
		{
			Content = stackPanel2,
			VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
			HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
			PanningMode = PanningMode.VerticalOnly
		};
		Border element = new Border
		{
			Child = child,
			Background = Brushes.White,
			BorderBrush = Brush("#DCE5DA"),
			BorderThickness = new Thickness(1.0),
			CornerRadius = new CornerRadius(12.0)
		};
		Grid.SetRow(element, 1);
		grid.Children.Add(element);
		StackPanel stackPanel3 = new StackPanel
		{
			Margin = new Thickness(0.0, 8.0, 0.0, 0.0)
		};
		stackPanel3.Children.Add(status);
		WrapPanel wrapPanel = new WrapPanel
		{
			HorizontalAlignment = HorizontalAlignment.Right,
			Margin = new Thickness(0.0, 8.0, 0.0, 0.0)
		};
		Button copy = MakeButton(updatesOnly ? "复制链接与提取码" : "复制全部");
		AutomationProperties.SetAutomationId(copy, "DisclaimerCopyAll");
		copy.Click += async delegate
		{
			await disclaimerWindow.CopyAllAsync(copy);
		};
		Button button = MakeButton(updatesOnly ? "关闭" : "我已阅读，继续", primary: true);
		AutomationProperties.SetAutomationId(button, "DisclaimerContinue");
		button.IsDefault = true;
		button.Click += delegate
		{
			if (updatesOnly)
			{
				disclaimerWindow.Close();
			}
			else
			{
				disclaimerWindow.DialogResult = true;
			}
		};
		wrapPanel.Children.Add(copy);
		wrapPanel.Children.Add(button);
		stackPanel3.Children.Add(wrapPanel);
		Grid.SetRow(stackPanel3, 2);
		grid.Children.Add(stackPanel3);
		base.Content = grid;
	}

	private FrameworkElement LinkRow(string label, string literalUrl, string extractionCode, string automationId)
	{
		Grid obj = new Grid
		{
			Margin = new Thickness(0.0, 12.0, 0.0, 0.0),
			ColumnDefinitions = 
			{
				new ColumnDefinition
				{
					Width = new GridLength(1.0, GridUnitType.Star)
				},
				new ColumnDefinition
				{
					Width = GridLength.Auto
				}
			}
		};
		StackPanel stackPanel = new StackPanel
		{
			Margin = new Thickness(0.0, 0.0, 10.0, 0.0)
		};
		stackPanel.Children.Add(new TextBlock
		{
			Text = label,
			FontSize = 16.0,
			FontWeight = FontWeights.Bold,
			Foreground = Brush("#65736D"),
			Margin = new Thickness(0.0, 0.0, 0.0, 3.0)
		});
		TextBox textBox = SelectableText(literalUrl);
		textBox.Foreground = Brush("#236B51");
		textBox.FontSize = 15.0;
		textBox.FontWeight = FontWeights.SemiBold;
		stackPanel.Children.Add(textBox);
		TextBox textBox2 = SelectableText("提取码：" + extractionCode);
		textBox2.FontSize = 12.0;
		textBox2.Foreground = Brush("#65736D");
		textBox2.Margin = new Thickness(0.0, 4.0, 0.0, 0.0);
		if (extractionCode.Length > 0)
		{
			stackPanel.Children.Add(textBox2);
		}
		obj.Children.Add(stackPanel);
		Button button = MakeButton("打开链接");
		AutomationProperties.SetAutomationId(button, automationId);
		button.VerticalAlignment = VerticalAlignment.Center;
		button.Click += delegate
		{
			try
			{
				Process.Start(new ProcessStartInfo(literalUrl)
				{
					UseShellExecute = true
				});
				status.Text = "已交由系统浏览器打开链接。";
			}
			catch
			{
				status.Text = "未能打开系统浏览器。可复制上方完整链接后自行打开。";
			}
		};
		Grid.SetColumn(button, 1);
		obj.Children.Add(button);
		return obj;
	}

	private async Task CopyAllAsync(Button button)
	{
		button.IsEnabled = false;
		try
		{
			for (int attempt = 0; attempt < 3; attempt++)
			{
				try
				{
					Clipboard.SetText(updatesOnly ? DownloadText : FullText);
					status.Text = (updatesOnly ? "已复制官方来源、视频与下载链接。" : "已复制全部说明和官方来源。");
					break;
				}
				catch (ExternalException) when (attempt < 2)
				{
					await Task.Delay(80);
				}
				catch
				{
					status.Text = "复制未完成，可选中正文或链接后手动复制。";
					break;
				}
			}
		}
		finally
		{
			button.IsEnabled = true;
		}
	}

	private static TextBox SelectableText(string text)
	{
		return new TextBox
		{
			Text = text,
			IsReadOnly = true,
			IsReadOnlyCaretVisible = true,
			AcceptsReturn = true,
			TextWrapping = TextWrapping.Wrap,
			BorderThickness = new Thickness(0.0),
			Background = Brushes.Transparent,
			Padding = new Thickness(0.0),
			VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
			HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
		};
	}

	private static SolidColorBrush Brush(string color)
	{
		return new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));
	}

	private static Button MakeButton(string text, bool primary = false)
	{
		return new Button
		{
			Content = text,
			Padding = new Thickness(16.0, 9.0, 16.0, 9.0),
			Margin = new Thickness(4.0, 2.0, 0.0, 2.0),
			FontSize = 13.0,
			Background = (primary ? Brush("#487F65") : Brushes.White),
			Foreground = (primary ? Brushes.White : Brush("#426653")),
			BorderBrush = Brush("#D4DFD1"),
			BorderThickness = new Thickness(1.0),
			Cursor = Cursors.Hand
		};
	}
}
