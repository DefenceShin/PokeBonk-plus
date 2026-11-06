using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace PokeBonk.Client;

internal sealed class SkinFileStore
{
	private sealed record Skin(string Id, string Name, byte[] Png, string Thumbnail, string Hash, bool Builtin, string[] Warnings, int AtlasWidth);

	private sealed record BuiltinSkin(string Id, string DefaultName, string Name, byte[] Png, bool Hidden);

	internal sealed record SkinNormalization(byte[] Png, string[] Warnings);

	internal const int MaximumInputBytes = 12582912;

	internal const int MaximumSkinCount = 120;

	internal const int MaximumIndexBytes = 2097152;

	internal const long MaximumStoredPngBytes = 134217728L;

	internal const int FrameSize = 256;

	internal const int LegacyFrameSize = 64;

	internal const int AtlasSize = 1024;

	internal const string BuiltinId = "author-dog";

	internal const string OtherBuiltinId = "author-other-dog";

	internal const string PoopBuiltinId = "dog-poop";

	internal const string FluffBuiltinId = "dog-fluff";

	internal const string Skin001BuiltinId = "skin-001";

	internal const string Skin002BuiltinId = "skin-002";

	internal const string Skin003BuiltinId = "skin-003";

	internal const string Skin004BuiltinId = "skin-004";

	private static readonly string[] BuiltinIds = new string[8] { "author-dog", "author-other-dog", "dog-poop", "dog-fluff", "skin-001", "skin-002", "skin-003", "skin-004" };

	private const string FormatName = "pokebonk-skin";

	private const string LayoutName = "4x4-idle-walk-jump-fall-v1";

	private static readonly UTF8Encoding Utf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

	private static readonly Regex UserId = new Regex("^skin-[a-f0-9]{32}$", RegexOptions.CultureInvariant);

	private readonly PortableStorage storage;

	private readonly object gate = new object();

	private readonly List<Skin> skins = new List<Skin>();

	private readonly Dictionary<string, BuiltinSkin> builtinSkins = new Dictionary<string, BuiltinSkin>(StringComparer.Ordinal);

	private readonly Dictionary<string, Skin> builtinRecords = new Dictionary<string, Skin>(StringComparer.Ordinal);

	private string? selectedId;

	private string warning = "";

	private const string RecommendationWarning = "文件不符合推荐标准，可能不达预期。";

	internal string Prompt { get; }

	private string Folder => storage.DataPath("skins");

	private string IndexPath => storage.DataPath(Path.Combine("skins", "index.json"));

	internal string? SelectedId
	{
		get
		{
			lock (gate)
			{
				return selectedId;
			}
		}
	}

	private string ImagePath(string id)
	{
		if (!UserId.IsMatch(id))
		{
			throw new InvalidDataException("皮肤编号无效");
		}
		return storage.DataPath(Path.Combine("skins", id + ".png"));
	}

	internal SkinFileStore(PortableStorage storage, byte[]? builtinPng = null, string? prompt = null, byte[]? otherBuiltinPng = null, byte[]? poopBuiltinPng = null, byte[]? fluffBuiltinPng = null, byte[]? skin001BuiltinPng = null, byte[]? skin002BuiltinPng = null, byte[]? skin003BuiltinPng = null, byte[]? skin004BuiltinPng = null)
	{
		this.storage = storage;
		byte[] png = ValidateCanonicalPng(builtinPng ?? ReadResource("payload.author-dog.png"));
		byte[] png2 = ValidateCanonicalPng((byte[])(otherBuiltinPng ?? ((builtinPng != null) ? ((object)builtinPng) : ((object)ReadResource("payload.author-other-dog.png")))));
		byte[] png3 = ValidateCanonicalPng((byte[])(poopBuiltinPng ?? ((builtinPng != null) ? ((object)builtinPng) : ((object)ReadResource("payload.dog-poop.png")))));
		byte[] png4 = ValidateCanonicalPng((byte[])(fluffBuiltinPng ?? ((builtinPng != null) ? ((object)builtinPng) : ((object)ReadResource("payload.dog-fluff.png")))));
		byte[] png5 = ValidateCanonicalPng((byte[])(skin001BuiltinPng ?? ((builtinPng != null) ? ((object)builtinPng) : ((object)ReadResource("payload.skin-001.png")))));
		byte[] png6 = ValidateCanonicalPng((byte[])(skin002BuiltinPng ?? ((builtinPng != null) ? ((object)builtinPng) : ((object)ReadResource("payload.skin-002.png")))));
		byte[] png7 = ValidateCanonicalPng((byte[])(skin003BuiltinPng ?? ((builtinPng != null) ? ((object)builtinPng) : ((object)ReadResource("payload.skin-003.png")))));
		byte[] png8 = ValidateCanonicalPng((byte[])(skin004BuiltinPng ?? ((builtinPng != null) ? ((object)builtinPng) : ((object)ReadResource("payload.skin-004.png")))));
		builtinSkins["author-dog"] = new BuiltinSkin("author-dog", "作者的狗", "作者的狗", png, Hidden: false);
		builtinSkins["author-other-dog"] = new BuiltinSkin("author-other-dog", "作者的另一条狗", "作者的另一条狗", png2, Hidden: false);
		builtinSkins["dog-poop"] = new BuiltinSkin("dog-poop", "狗粑粑", "狗粑粑", png3, Hidden: false);
		builtinSkins["dog-fluff"] = new BuiltinSkin("dog-fluff", "狗毛球", "狗毛球", png4, Hidden: false);
		builtinSkins["skin-001"] = new BuiltinSkin("skin-001", "皮肤001", "皮肤001", png5, Hidden: false);
		builtinSkins["skin-002"] = new BuiltinSkin("skin-002", "皮肤002", "皮肤002", png6, Hidden: false);
		builtinSkins["skin-003"] = new BuiltinSkin("skin-003", "皮肤003", "皮肤003", png7, Hidden: false);
		builtinSkins["skin-004"] = new BuiltinSkin("skin-004", "皮肤004", "皮肤004", png8, Hidden: false);
		Prompt = prompt ?? Utf8.GetString(ReadResource("payload.skin-generation-prompt.txt"));
		int length = Prompt.Length;
		if ((length < 40 || length > 40000) ? true : false)
		{
			throw new InvalidDataException("皮肤生成提示词资源无效");
		}
		Load();
	}

	private static byte[] ReadResource(string name)
	{
		using Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name) ?? throw new InvalidDataException("客户端缺少皮肤资源，请重新下载完整客户端");
		return ReadBounded(stream, 12582912);
	}

	private void Load()
	{
		string path = storage.ValidatePath(IndexPath);
		if (!File.Exists(path))
		{
			return;
		}
		try
		{
			using FileStream stream = File.OpenRead(path);
			string json = Utf8.GetString(ReadBounded(stream, 2097152));
			JsonDocumentOptions documentOptions = new JsonDocumentOptions
			{
				MaxDepth = 12
			};
			if (!(JsonNode.Parse(json, null, documentOptions) is JsonObject jsonObject) || Integer(jsonObject["schemaVersion"]) != 1 || !(jsonObject["skins"] is JsonArray { Count: <=120 } jsonArray) || jsonArray.Any((JsonNode node) => !(node is JsonObject)))
			{
				throw new InvalidDataException("皮肤目录格式无效");
			}
			Dictionary<string, BuiltinSkin> dictionary = builtinSkins;
			BuiltinSkin builtinSkin = builtinSkins["author-dog"];
			JsonNode? jsonNode = jsonObject["builtinHidden"];
			builtinSkin = builtinSkin with { Hidden = jsonNode != null && jsonNode.GetValueKind() == JsonValueKind.True, Name = ImportName(Text(jsonObject["builtinName"]) ?? "作者的狗") };
			dictionary["author-dog"] = builtinSkin;
			if (jsonObject["builtins"] is JsonObject jsonObject2)
			{
				string[] builtinIds = BuiltinIds;
				foreach (string text in builtinIds)
				{
					if (!(jsonObject2[text] is JsonObject jsonObject3))
					{
						continue;
					}
					BuiltinSkin builtinSkin2 = builtinSkins[text];
					Dictionary<string, BuiltinSkin> dictionary2 = builtinSkins;
					string key = text;
					BuiltinSkin builtinSkin3 = builtinSkin2;
					JsonValueKind? jsonValueKind = jsonObject3["hidden"]?.GetValueKind();
					bool flag;
					if (jsonValueKind.HasValue)
					{
						JsonValueKind valueOrDefault = jsonValueKind.GetValueOrDefault();
						if (valueOrDefault - 5 <= JsonValueKind.Object)
						{
							flag = true;
							goto IL_01fd;
						}
					}
					flag = false;
					goto IL_01fd;
					IL_01fd:
					bool hidden = flag ? jsonObject3["hidden"].GetValue<bool>() : builtinSkin2.Hidden;
					string text2 = Text(jsonObject3["name"]);
					builtinSkin3 = builtinSkin3 with { Hidden = hidden, Name = (text2 != null) ? ImportName(text2) : builtinSkin2.Name };
					dictionary2[key] = builtinSkin3;
				}
			}
			HashSet<string> hashSet = new HashSet<string>(StringComparer.Ordinal);
			foreach (JsonObject item in jsonArray.OfType<JsonObject>())
			{
				string text3 = Text(item["id"]);
				if (text3 == null || !UserId.IsMatch(text3) || !hashSet.Add(text3))
				{
					throw new InvalidDataException("皮肤目录包含无效编号");
				}
				try
				{
					using FileStream stream2 = File.OpenRead(storage.ValidatePath(ImagePath(text3)));
					byte[] array = ValidateCanonicalPng(ReadBounded(stream2, 12582912));
					if (((IEnumerable<Skin>)skins).Sum((Func<Skin, long>)((Skin s) => s.Png.Length)) + array.Length > 134217728)
					{
						warning = "本地皮肤库超过 128 MB 安全内存预算，部分皮肤暂未载入；原文件已保留，可减少皮肤后重启。";
						continue;
					}
					string text4 = Text(item["hash"]);
					Skin skin = MakeSkin(text3, NormalizeName(Text(item["name"]) ?? "未命名皮肤"), array, builtin: false, ReadWarnings(item["warnings"]));
					if (text4 != null && !string.Equals(text4, skin.Hash, StringComparison.Ordinal))
					{
						throw new InvalidDataException("皮肤文件校验失败");
					}
					skins.Add(skin);
				}
				catch (Exception ex) when (((ex is IOException || ex is InvalidDataException || ex is UnauthorizedAccessException || ex is NotSupportedException || ex is COMException) ? 1 : 0) != 0)
				{
					warning = "部分本地皮肤无法读取，已保留原文件；可重新导入有效皮肤。";
				}
			}
			string choice = Text(jsonObject["selectedId"]);
			selectedId = (All().Any((Skin s) => s.Id == choice) ? choice : null);
		}
		catch (Exception ex2) when (((ex2 is IOException || ex2 is JsonException || ex2 is InvalidDataException || ex2 is ArgumentException || ex2 is UnauthorizedAccessException) ? 1 : 0) != 0)
		{
			skins.Clear();
			selectedId = null;
			string[] builtinIds = BuiltinIds;
			foreach (string key2 in builtinIds)
			{
				builtinSkins[key2] = builtinSkins[key2]with
				{
					Hidden = false,
					Name = builtinSkins[key2].DefaultName
				};
			}
			warning = "本地皮肤目录无法读取，暂时使用游戏原形象；原文件已保留。";
		}
	}

	private Skin BuiltinRecord(BuiltinSkin skin)
	{
		if (!builtinRecords.TryGetValue(skin.Id, out Skin value))
		{
			value = (builtinRecords[skin.Id] = MakeSkin(skin.Id, skin.Name, skin.Png, builtin: true));
		}
		if (!(value.Name == skin.Name))
		{
			return value with
			{
				Name = skin.Name
			};
		}
		return value;
	}

	private Skin Find(string id)
	{
		BuiltinSkin value;
		return (builtinSkins.TryGetValue(id, out value) && !value.Hidden) ? BuiltinRecord(value) : (skins.FirstOrDefault((Skin s) => s.Id == id) ?? throw new InvalidOperationException("该皮肤已不存在，请刷新皮肤列表"));
	}

	private IEnumerable<Skin> All()
	{
		return (from id in BuiltinIds
			select builtinSkins[id] into s
			where !s.Hidden
			select s).Select(BuiltinRecord).Concat(skins);
	}

	internal JsonObject State()
	{
		lock (gate)
		{
			return new JsonObject
			{
				["skins"] = new JsonArray(All().Select((Func<Skin, JsonNode>)((Skin s) => new JsonObject
				{
					["id"] = s.Id,
					["name"] = s.Name,
					["builtin"] = s.Builtin,
					["thumbnailDataUrl"] = s.Thumbnail,
					["width"] = s.AtlasWidth,
					["height"] = s.AtlasWidth,
					["frameWidth"] = s.AtlasWidth / 4,
					["frameHeight"] = s.AtlasWidth / 4,
					["warnings"] = WarningArray(s.Warnings)
				})).ToArray()),
				["selectedId"] = selectedId,
				["canRestoreBuiltin"] = builtinSkins.Values.Any((BuiltinSkin s) => s.Hidden),
				["warning"] = warning,
				["maximumSkins"] = 120,
				["schemaVersion"] = 1
			};
		}
	}

	internal JsonObject? Selection()
	{
		lock (gate)
		{
			return (selectedId == null) ? null : Payload(Find(selectedId));
		}
	}

	internal JsonObject Preview(string id)
	{
		lock (gate)
		{
			JsonObject jsonObject = Payload(Find(id));
			jsonObject["atlasDataUrl"] = jsonObject["pngDataUrl"].DeepClone();
			return jsonObject;
		}
	}

	private static JsonObject Payload(Skin skin)
	{
		JsonObject jsonObject = new JsonObject();
		jsonObject["id"] = skin.Id;
		jsonObject["name"] = skin.Name;
		jsonObject["pngDataUrl"] = DataUrl(skin.Png);
		jsonObject["frameSize"] = skin.AtlasWidth / 4;
		jsonObject["frameWidth"] = skin.AtlasWidth / 4;
		jsonObject["frameHeight"] = skin.AtlasWidth / 4;
		jsonObject["columns"] = 4;
		jsonObject["rows"] = 4;
		jsonObject["schemaVersion"] = 1;
		jsonObject["animationOrder"] = new JsonArray("idle", "walk", "jump", "fall");
		jsonObject["warnings"] = WarningArray(skin.Warnings);
		return jsonObject;
	}

	internal JsonObject Import(string selectedFile)
	{
		string text = ValidateImportPath(selectedFile);
		bool flag = text.EndsWith(".png", StringComparison.OrdinalIgnoreCase);
		if (!flag && !text.EndsWith(".pbskin.json", StringComparison.OrdinalIgnoreCase))
		{
			throw new InvalidDataException("请选择 PNG 精灵图集或 .pbskin.json 皮肤文件；GIF 不能区分动作，不支持直接导入");
		}
		byte[] bytes;
		using (FileStream stream = File.OpenRead(text))
		{
			bytes = ReadBounded(stream, 12582912);
		}
		string text2 = Path.GetFileNameWithoutExtension(flag ? text : Path.GetFileNameWithoutExtension(text));
		string[] second = Array.Empty<string>();
		if (!flag)
		{
			JsonObject jsonObject;
			try
			{
				string json = Utf8.GetString(bytes).TrimStart('\ufeff');
				JsonDocumentOptions documentOptions = new JsonDocumentOptions
				{
					MaxDepth = 12
				};
				jsonObject = JsonNode.Parse(json, null, documentOptions) as JsonObject;
			}
			catch (Exception ex) when (((ex is JsonException || ex is DecoderFallbackException) ? 1 : 0) != 0)
			{
				throw new InvalidDataException("皮肤包不是有效的 UTF-8 JSON 文件，请重新导出或导入原始 PNG 图集", ex);
			}
			if (jsonObject == null || Integer(jsonObject["schemaVersion"]) != 1 || Text(jsonObject["format"]) != "pokebonk-skin" || Text(jsonObject["layout"]) != "4x4-idle-walk-jump-fall-v1")
			{
				throw new InvalidDataException("皮肤包格式或版本不受支持，请导入本客户端导出的 .pbskin.json 文件");
			}
			text2 = Text(jsonObject["name"]) ?? text2;
			second = ReadWarnings(jsonObject["warnings"]);
			string text3 = Text(jsonObject["pngDataUrl"]) ?? throw new InvalidDataException("皮肤包缺少 PNG 图集");
			if (!text3.StartsWith("data:image/png;base64,", StringComparison.Ordinal) || text3.Length > 12582912)
			{
				throw new InvalidDataException("皮肤包只允许内嵌 PNG 图片，不允许网址或外部文件");
			}
			try
			{
				bytes = Convert.FromBase64String(text3.Substring(22));
			}
			catch (FormatException)
			{
				throw new InvalidDataException("皮肤包中的 PNG 编码无效");
			}
		}
		SkinNormalization skinNormalization = NormalizePngWithWarnings(bytes);
		byte[] png = skinNormalization.Png;
		string hash = Hash(png);
		lock (gate)
		{
			Skin skin = All().FirstOrDefault((Skin s) => s.Hash == hash);
			if ((object)skin != null)
			{
				JsonObject jsonObject2 = State();
				jsonObject2["importedId"] = skin.Id;
				jsonObject2["duplicate"] = true;
				jsonObject2["cancelled"] = false;
				return jsonObject2;
			}
			BuiltinSkin builtinSkin = builtinSkins.Values.FirstOrDefault((BuiltinSkin s) => s.Hidden && hash == Hash(s.Png));
			if ((object)builtinSkin != null)
			{
				JsonObject jsonObject3 = RestoreBuiltin(builtinSkin.Id);
				jsonObject3["importedId"] = builtinSkin.Id;
				jsonObject3["duplicate"] = true;
				jsonObject3["cancelled"] = false;
				return jsonObject3;
			}
			if (((IEnumerable<Skin>)skins).Sum((Func<Skin, long>)((Skin s) => s.Png.Length)) + png.Length > 134217728)
			{
				throw new InvalidOperationException("本地皮肤库已达到 128 MB 安全内存预算，请先删除不需要的皮肤；原文件不会删除");
			}
			if (skins.Count >= 120)
			{
				throw new InvalidOperationException($"最多保存 {120} 个自定义皮肤，请先删除不需要的皮肤");
			}
			text2 = UniqueName(ImportName(text2));
			Skin skin2 = MakeSkin("skin-" + Guid.NewGuid().ToString("N"), text2, png, builtin: false, skinNormalization.Warnings.Concat(second));
			storage.EnsureDirectory(Folder);
			string path = storage.ValidatePath(ImagePath(skin2.Id));
			try
			{
				using (FileStream fileStream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
				{
					fileStream.Write(png);
					fileStream.Flush(flushToDisk: true);
				}
				skins.Add(skin2);
				try
				{
					Save();
				}
				catch
				{
					skins.Remove(skin2);
					throw;
				}
			}
			catch
			{
				if (File.Exists(path))
				{
					File.Delete(storage.ValidatePath(path));
				}
				throw;
			}
			JsonObject jsonObject4 = State();
			jsonObject4["importedId"] = skin2.Id;
			jsonObject4["duplicate"] = false;
			jsonObject4["cancelled"] = false;
			return jsonObject4;
		}
	}

	internal JsonObject Select(string? id)
	{
		lock (gate)
		{
			if (string.IsNullOrWhiteSpace(id))
			{
				id = null;
			}
			if (id != null)
			{
				Find(id);
			}
			string text = selectedId;
			selectedId = id;
			try
			{
				Save();
			}
			catch
			{
				selectedId = text;
				throw;
			}
			return State();
		}
	}

	internal JsonObject Rename(string id, string name)
	{
		lock (gate)
		{
			Skin skin = Find(id);
			name = NormalizeName(name);
			if (All().Any((Skin s) => s.Id != id && string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase)))
			{
				throw new InvalidOperationException("已有同名皮肤，请换一个名称");
			}
			if (skin.Builtin)
			{
				BuiltinSkin builtinSkin = builtinSkins[id];
				builtinSkins[id] = builtinSkin with
				{
					Name = name
				};
				try
				{
					Save();
				}
				catch
				{
					builtinSkins[id] = builtinSkin;
					throw;
				}
			}
			else
			{
				int index = skins.IndexOf(skin);
				skins[index] = skin with
				{
					Name = name
				};
				try
				{
					Save();
				}
				catch
				{
					skins[index] = skin;
					throw;
				}
			}
			return State();
		}
	}

	internal JsonObject Delete(string id)
	{
		lock (gate)
		{
			Skin skin = Find(id);
			string text = selectedId;
			int index = skins.IndexOf(skin);
			if (skin.Builtin)
			{
				builtinSkins[id] = builtinSkins[id]with
				{
					Hidden = true
				};
			}
			else
			{
				skins.Remove(skin);
			}
			if (selectedId == id)
			{
				selectedId = null;
			}
			try
			{
				Save();
			}
			catch
			{
				selectedId = text;
				if (skin.Builtin)
				{
					builtinSkins[id] = builtinSkins[id]with
					{
						Hidden = false
					};
				}
				else
				{
					skins.Insert(index, skin);
				}
				throw;
			}
			if (!skin.Builtin)
			{
				try
				{
					string path = storage.ValidatePath(ImagePath(id));
					if (File.Exists(path))
					{
						File.Delete(path);
					}
				}
				catch (Exception ex) when (((ex is IOException || ex is UnauthorizedAccessException) ? 1 : 0) != 0)
				{
					warning = "皮肤已从列表删除；图片文件暂被占用，保留在本地目录。";
				}
			}
			return State();
		}
	}

	internal JsonObject RestoreBuiltin(string? id = null)
	{
		lock (gate)
		{
			if (id != null && !builtinSkins.ContainsKey(id))
			{
				throw new InvalidOperationException("内置皮肤编号无效");
			}
			Dictionary<string, BuiltinSkin> dictionary = builtinSkins.ToDictionary<KeyValuePair<string, BuiltinSkin>, string, BuiltinSkin>((KeyValuePair<string, BuiltinSkin> p) => p.Key, (KeyValuePair<string, BuiltinSkin> p) => p.Value, StringComparer.Ordinal);
			string[] builtinIds = BuiltinIds;
			foreach (string text in builtinIds)
			{
				if (id == null || text == id)
				{
					builtinSkins[text] = builtinSkins[text]with
					{
						Hidden = false
					};
				}
			}
			try
			{
				Save();
			}
			catch
			{
				foreach (KeyValuePair<string, BuiltinSkin> item in dictionary)
				{
					builtinSkins[item.Key] = item.Value;
				}
				throw;
			}
			return State();
		}
	}

	internal string SuggestedExportName(string id, bool png)
	{
		lock (gate)
		{
			string text = Find(id).Name;
			char[] invalidFileNameChars = Path.GetInvalidFileNameChars();
			foreach (char oldChar in invalidFileNameChars)
			{
				text = text.Replace(oldChar, '_');
			}
			text = text.Trim().TrimEnd('.');
			return ((text.Length > 0) ? text : "皮肤") + (png ? ".png" : ".pbskin.json");
		}
	}

	internal void Export(string id, string selectedFile, bool png)
	{
		lock (gate)
		{
			Skin skin = Find(id);
			ValidateExportPath(selectedFile);
			if (!selectedFile.EndsWith(png ? ".png" : ".pbskin.json", StringComparison.OrdinalIgnoreCase))
			{
				throw new InvalidDataException(png ? "导出图集请使用 .png 文件名" : "导出皮肤包请使用 .pbskin.json 文件名");
			}
			byte[] bytes = (png ? skin.Png : Utf8.GetBytes(new JsonObject
			{
				["format"] = "pokebonk-skin",
				["schemaVersion"] = 1,
				["layout"] = "4x4-idle-walk-jump-fall-v1",
				["name"] = skin.Name,
				["pngDataUrl"] = DataUrl(skin.Png),
				["warnings"] = WarningArray(skin.Warnings)
			}.ToJsonString(new JsonSerializerOptions
			{
				WriteIndented = true
			})));
			AtomicWrite(selectedFile, bytes);
		}
	}

	internal void SavePrompt(string selectedFile)
	{
		ValidateExportPath(selectedFile);
		if (!selectedFile.EndsWith(".txt", StringComparison.OrdinalIgnoreCase))
		{
			throw new InvalidDataException("提示词请保存为 .txt 文本文件");
		}
		AtomicWrite(selectedFile, Utf8.GetBytes(Prompt));
	}

	private void ValidateExportPath(string selectedFile)
	{
		string text = storage.ValidatePath(selectedFile);
		string text2 = storage.DataPath("exports");
		if (!text.StartsWith(text2 + Path.DirectorySeparatorChar, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
		{
			throw new InvalidOperationException("请保存到客户端 data/exports 文件夹内，避免覆盖配置或皮肤原文件；之后可手动复制或分享。");
		}
	}

	private void Save()
	{
		byte[] bytes = Utf8.GetBytes(new JsonObject
		{
			["schemaVersion"] = 1,
			["selectedId"] = selectedId,
			["builtinHidden"] = builtinSkins["author-dog"].Hidden,
			["builtinName"] = builtinSkins["author-dog"].Name,
			["builtins"] = new JsonObject(BuiltinIds.Select((string id) => KeyValuePair.Create(id, (JsonNode)new JsonObject
			{
				["name"] = builtinSkins[id].Name,
				["hidden"] = builtinSkins[id].Hidden
			}))),
			["skins"] = new JsonArray(((IEnumerable<Skin>)skins).Select((Func<Skin, JsonNode>)((Skin s) => new JsonObject
			{
				["id"] = s.Id,
				["name"] = s.Name,
				["hash"] = s.Hash,
				["warnings"] = WarningArray(s.Warnings)
			})).ToArray())
		}.ToJsonString(new JsonSerializerOptions
		{
			WriteIndented = true
		}));
		if (bytes.Length > 2097152)
		{
			throw new InvalidDataException("本地皮肤目录超过安全大小限制，请减少皮肤或缩短名称");
		}
		AtomicWrite(IndexPath, bytes);
	}

	private void AtomicWrite(string selectedFile, byte[] bytes)
	{
		string text = storage.ValidatePath(selectedFile);
		storage.EnsureDirectory(Path.GetDirectoryName(text));
		string path = storage.ValidatePath(text + ".pending-" + Guid.NewGuid().ToString("N"));
		try
		{
			using (FileStream fileStream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
			{
				fileStream.Write(bytes);
				fileStream.Flush(flushToDisk: true);
			}
			File.Move(storage.ValidatePath(path), storage.ValidatePath(text), overwrite: true);
		}
		finally
		{
			if (File.Exists(path))
			{
				File.Delete(storage.ValidatePath(path));
			}
		}
	}

	private string UniqueName(string name)
	{
		string text = name;
		int num = 2;
		while (All().Any((Skin s) => string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase)))
		{
			string text2 = $"（{num++}）";
			name = Truncate(text, 40 - new StringInfo(text2).LengthInTextElements) + text2;
		}
		return name;
	}

	private static string NormalizeName(string name)
	{
		name = Regex.Replace(name.Normalize(NormalizationForm.FormC), "[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]", " ").Trim();
		name = Regex.Replace(name, "\\s+", " ");
		if (name.Length == 0)
		{
			throw new InvalidDataException("请输入皮肤名称");
		}
		if (name.Length > 160 || new StringInfo(name).LengthInTextElements > 40)
		{
			throw new InvalidDataException("皮肤名称最多 40 个字符");
		}
		return name;
	}

	private static string ImportName(string name)
	{
		if (name.Length > 160)
		{
			name = name.Substring(0, 160);
		}
		if (name.Length > 0)
		{
			string text = name;
			if (char.IsHighSurrogate(text[text.Length - 1]))
			{
				string text2 = name;
				name = text2.Substring(0, text2.Length - 1);
			}
		}
		name = Regex.Replace(name, "[\\p{Cc}\\p{Cf}]", " ").Trim();
		if (name.Length == 0)
		{
			return "导入的皮肤";
		}
		try
		{
			return NormalizeName(Truncate(name, 40));
		}
		catch (ArgumentException)
		{
			return "导入的皮肤";
		}
	}

	private static string Truncate(string text, int length)
	{
		int[] array = StringInfo.ParseCombiningCharacters(text);
		if (array.Length > length)
		{
			return text.Substring(0, array[length]);
		}
		return text;
	}

	private static string? Text(JsonNode? value)
	{
		if (value == null || value.GetValueKind() != JsonValueKind.String)
		{
			return null;
		}
		return value.GetValue<string>();
	}

	private static int? Integer(JsonNode? value)
	{
		if (!(value is JsonValue jsonValue) || !jsonValue.TryGetValue<int>(out var value2))
		{
			return null;
		}
		return value2;
	}

	private static string Hash(byte[] bytes)
	{
		return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
	}

	private static string DataUrl(byte[] png)
	{
		return "data:image/png;base64," + Convert.ToBase64String(png);
	}

	private static string[] ReadWarnings(JsonNode? value)
	{
		if (!(value is JsonArray source))
		{
			return Array.Empty<string>();
		}
		return CleanWarnings(source.Select(Text).OfType<string>());
	}

	private static string[] CleanWarnings(IEnumerable<string> values)
	{
		return (from v in values.Select(delegate(string v)
			{
				if (v.Length > 160)
				{
					v = v.Substring(0, 160);
				}
				if (v.Length > 0)
				{
					string text = v;
					if (char.IsHighSurrogate(text[text.Length - 1]))
					{
						string text2 = v;
						v = text2.Substring(0, text2.Length - 1);
					}
				}
				return Regex.Replace(v, "[\\p{Cc}\\p{Cf}]", " ").Trim();
			})
			where v.Length > 0
			select v).Distinct<string>(StringComparer.Ordinal).Take(12).ToArray();
	}

	private static JsonArray WarningArray(IEnumerable<string> values)
	{
		return new JsonArray(values.Select((Func<string, JsonNode>)((string v) => JsonValue.Create(v))).ToArray());
	}

	private static Skin MakeSkin(string id, string name, byte[] png, bool builtin, IEnumerable<string>? warnings = null)
	{
		return new Skin(id, name, png, Thumbnail(png), Hash(png), builtin, builtin ? Array.Empty<string>() : CleanWarnings(warnings ?? Array.Empty<string>()), BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(16, 4)));
	}

	private static string Thumbnail(byte[] png)
	{
		BitmapSource bitmapSource = Decode(png);
		return DataUrl(Encode(new CroppedBitmap(bitmapSource, new Int32Rect(0, 0, bitmapSource.PixelWidth / 4, bitmapSource.PixelHeight / 4))));
	}

	private static byte[] ReadBounded(Stream stream, int limit)
	{
		using MemoryStream memoryStream = new MemoryStream();
		byte[] array = new byte[8192];
		int num;
		while ((num = stream.Read(array, 0, array.Length)) > 0)
		{
			if (memoryStream.Length + num > limit)
			{
				throw new InvalidDataException($"皮肤文件超过 {limit / 1048576} MB 限制");
			}
			memoryStream.Write(array, 0, num);
		}
		return memoryStream.ToArray();
	}

	private static string ValidateImportPath(string selectedFile)
	{
		string fullPath = Path.GetFullPath(selectedFile);
		if (new Uri(fullPath).IsUnc)
		{
			throw new InvalidDataException("请先将皮肤下载到本机，再选择本地文件导入");
		}
		string text = Path.GetPathRoot(fullPath) ?? throw new InvalidDataException("皮肤文件路径无效");
		if (OperatingSystem.IsWindows() && fullPath.Substring(text.Length).Contains(':'))
		{
			throw new InvalidDataException("皮肤文件不能使用备用数据流");
		}
		if (new DriveInfo(text).DriveType == DriveType.Network)
		{
			throw new InvalidDataException("请先将皮肤下载到本机，再选择本地文件导入");
		}
		string text2 = text;
		string[] array = fullPath.Substring(text.Length).Split(new char[2]
		{
			Path.DirectorySeparatorChar,
			Path.AltDirectorySeparatorChar
		}, StringSplitOptions.RemoveEmptyEntries);
		foreach (string path in array)
		{
			text2 = Path.Combine(text2, path);
			FileAttributes attributes = File.GetAttributes(text2);
			if ((attributes & FileAttributes.ReparsePoint) != FileAttributes.None)
			{
				throw new InvalidDataException("皮肤文件或所在目录不能是符号链接或目录联接");
			}
			if ((attributes & (FileAttributes)4460544) != FileAttributes.None)
			{
				throw new InvalidDataException("请先将云端皮肤下载为本机文件，再导入；客户端不会主动下载外部图片");
			}
		}
		return fullPath;
	}

	private static BitmapSource Decode(byte[] bytes)
	{
		using MemoryStream bitmapStream = new MemoryStream(bytes, writable: false);
		PngBitmapDecoder pngBitmapDecoder = new PngBitmapDecoder(bitmapStream, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
		if (pngBitmapDecoder.Frames.Count != 1)
		{
			throw new InvalidDataException("请使用一张静态 PNG 精灵图集");
		}
		FormatConvertedBitmap formatConvertedBitmap = new FormatConvertedBitmap(pngBitmapDecoder.Frames[0], PixelFormats.Bgra32, null, 0.0);
		formatConvertedBitmap.Freeze();
		return formatConvertedBitmap;
	}

	private static byte[] Encode(BitmapSource bitmap)
	{
		PngBitmapEncoder pngBitmapEncoder = new PngBitmapEncoder();
		pngBitmapEncoder.Frames.Add(BitmapFrame.Create(bitmap));
		using MemoryStream memoryStream = new MemoryStream();
		pngBitmapEncoder.Save(memoryStream);
		return memoryStream.ToArray();
	}

	private static void ClearRecognisableBackground(byte[] pixels, int imageWidth, int imageHeight, int row, int column, List<string> warnings)
	{
		int left = (column * imageWidth + 3) / 4;
		int top = (row * imageHeight + 3) / 4;
		int num = ((column + 1) * imageWidth + 3) / 4;
		int num2 = ((row + 1) * imageHeight + 3) / 4;
		int width = num - left;
		int num3 = num2 - top;
		int num4 = width * num3;
		int num5 = 0;
		if (width == 0 || num3 == 0)
		{
			return;
		}
		for (int i = 0; i < num3; i++)
		{
			for (int j = 0; j < width; j++)
			{
				if (pixels[Offset(j, i) + 3] == 0)
				{
					num5++;
				}
			}
		}
		if (num5 >= num4 / 20)
		{
			return;
		}
		List<(byte B, byte G, byte R)> border = new List<(byte, byte, byte)>();
		for (int k = 0; k < width; k++)
		{
			Sample(k, 0);
			Sample(k, num3 - 1);
		}
		for (int l = 1; l < num3 - 1; l++)
		{
			Sample(0, l);
			Sample(width - 1, l);
		}
		if (border.Count < 16)
		{
			return;
		}
		byte[] array = border.Select(((byte B, byte G, byte R) c) => c.B).Order().ToArray();
		byte[] array2 = border.Select(((byte B, byte G, byte R) c) => c.G).Order().ToArray();
		byte[] array3 = border.Select(((byte B, byte G, byte R) c) => c.R).Order().ToArray();
		int num6 = border.Count / 2;
		byte medianB = array[num6];
		byte medianG = array2[num6];
		byte medianR = array3[num6];
		bool neutral = (double)border.Count(((byte B, byte G, byte R) c) => Spread(c.B, c.G, c.R) <= 28 && Math.Min(c.B, Math.Min(c.G, c.R)) >= 175) >= (double)border.Count * 0.95;
		bool flag = (double)border.Count(((byte B, byte G, byte R) c) => Math.Abs(c.B - medianB) <= 24 && Math.Abs(c.G - medianG) <= 24 && Math.Abs(c.R - medianR) <= 24) >= (double)border.Count * 0.97;
		if (!neutral && !flag)
		{
			warnings.Add("背景比较复杂，未能可靠自动分离角色；已保留原图内容，显示可能带背景。");
			return;
		}
		int lowNeutral = Math.Max(135, Math.Min(array[border.Count / 50], Math.Min(array2[border.Count / 50], array3[border.Count / 50])) - 80);
		bool[] visited = new bool[num4];
		int[] queue = new int[num4];
		int num7 = 0;
		int tail = 0;
		for (int num8 = 0; num8 < width; num8++)
		{
			Add(num8, 0);
			Add(num8, num3 - 1);
		}
		for (int num9 = 1; num9 < num3 - 1; num9++)
		{
			Add(0, num9);
			Add(width - 1, num9);
		}
		while (num7 < tail)
		{
			int num10 = queue[num7++];
			int num11 = num10 % width;
			int num12 = num10 / width;
			if (num11 > 0)
			{
				Add(num11 - 1, num12);
			}
			if (num11 + 1 < width)
			{
				Add(num11 + 1, num12);
			}
			if (num12 > 0)
			{
				Add(num11, num12 - 1);
			}
			if (num12 + 1 < num3)
			{
				Add(num11, num12 + 1);
			}
		}
		if (tail < Math.Max(1, num4 / 30))
		{
			warnings.Add("部分格子的背景未能可靠清理，已保留原图内容。");
			return;
		}
		int num13 = 0;
		for (int num14 = 0; num14 < num3; num14++)
		{
			for (int num15 = 0; num15 < width; num15++)
			{
				if (!visited[num14 * width + num15] && pixels[Offset(num15, num14) + 3] > 16)
				{
					num13++;
				}
			}
		}
		if (num13 == 0)
		{
			warnings.Add("部分格子清理底色后未找到角色，已保留原图内容；请检查动作预览。");
			return;
		}
		for (int num16 = 0; num16 < tail; num16++)
		{
			int num17 = queue[num16];
			Array.Clear(pixels, Offset(num17 % width, num17 / width), 4);
		}
		void Add(int x, int y)
		{
			int num18 = y * width + x;
			if (!visited[num18] && IsBackground(x, y))
			{
				visited[num18] = true;
				queue[tail++] = num18;
			}
		}
		bool IsBackground(int x, int y)
		{
			int num18 = Offset(x, y);
			if (pixels[num18 + 3] == 0)
			{
				return true;
			}
			byte b = pixels[num18];
			byte b2 = pixels[num18 + 1];
			byte b3 = pixels[num18 + 2];
			if (!neutral)
			{
				if (Math.Abs(b - medianB) <= 28 && Math.Abs(b2 - medianG) <= 28)
				{
					return Math.Abs(b3 - medianR) <= 28;
				}
				return false;
			}
			if (Spread(b, b2, b3) <= 32)
			{
				return Math.Min(b, Math.Min(b2, b3)) >= lowNeutral;
			}
			return false;
		}
		int Offset(int x, int y)
		{
			return ((top + y) * imageWidth + left + x) * 4;
		}
		void Sample(int x, int y)
		{
			int num18 = Offset(x, y);
			if (pixels[num18 + 3] > 128)
			{
				border.Add((pixels[num18], pixels[num18 + 1], pixels[num18 + 2]));
			}
		}
		static int Spread(byte b, byte g, byte r)
		{
			return Math.Max(b, Math.Max(g, r)) - Math.Min(b, Math.Min(g, r));
		}
	}

	private static void ClearIsolatedNoise(byte[] pixels, int imageWidth, int imageHeight, int row, int column, bool legacy = false)
	{
		int left = (column * imageWidth + 3) / 4;
		int top = (row * imageHeight + 3) / 4;
		int width = ((column + 1) * imageWidth + 3) / 4 - left;
		int height = ((row + 1) * imageHeight + 3) / 4 - top;
		if (width == 0 || height == 0)
		{
			return;
		}
		bool[] visited = new bool[width * height];
		int[] queue = new int[width * height];
		int num = -1;
		int num2 = 0;
		int num3 = width;
		int num4 = -1;
		int num5 = height;
		int num6 = -1;
		int num7 = 0;
		for (int i = 0; i < visited.Length; i++)
		{
			if (visited[i] || pixels[Offset(i) + 3] == 0)
			{
				continue;
			}
			int num8 = Traverse(i);
			num7++;
			if (num8 > num2)
			{
				num = i;
				num2 = num8;
				num3 = width;
				num4 = -1;
				num5 = height;
				num6 = -1;
				for (int j = 0; j < num8; j++)
				{
					int val = queue[j] % width;
					int val2 = queue[j] / width;
					num3 = Math.Min(num3, val);
					num4 = Math.Max(num4, val);
					num5 = Math.Min(num5, val2);
					num6 = Math.Max(num6, val2);
				}
			}
		}
		if (num7 < 2)
		{
			return;
		}
		int num9 = (legacy ? Math.Max(2, num2 / 800) : 2);
		int num10 = (legacy ? 4 : Math.Max(4, width / 16));
		Array.Clear(visited);
		for (int k = 0; k < visited.Length; k++)
		{
			if (visited[k] || pixels[Offset(k) + 3] == 0)
			{
				continue;
			}
			int num11 = Traverse(k);
			if (k == num || num11 > num9)
			{
				continue;
			}
			bool flag = false;
			for (int l = 0; l < num11; l++)
			{
				int num12 = queue[l] % width;
				int num13 = queue[l] / width;
				if (num12 >= num3 - num10 && num12 <= num4 + num10 && num13 >= num5 - num10 && num13 <= num6 + num10)
				{
					flag = true;
					break;
				}
			}
			if (!flag)
			{
				for (int m = 0; m < num11; m++)
				{
					Array.Clear(pixels, Offset(queue[m]), 4);
				}
			}
		}
		int Offset(int index)
		{
			return ((top + index / width) * imageWidth + left + index % width) * 4;
		}
		int Traverse(int first)
		{
			int num14 = 0;
			int tail = 1;
			queue[0] = first;
			visited[first] = true;
			while (num14 < tail)
			{
				int num15 = queue[num14++];
				int num16 = num15 % width;
				int num17 = num15 / width;
				if (num16 > 0)
				{
					Add(num15 - 1);
				}
				if (num16 + 1 < width)
				{
					Add(num15 + 1);
				}
				if (num17 > 0)
				{
					Add(num15 - width);
				}
				if (num17 + 1 < height)
				{
					Add(num15 + width);
				}
			}
			return tail;
			void Add(int next)
			{
				if (!visited[next] && pixels[Offset(next) + 3] > 0)
				{
					visited[next] = true;
					queue[tail++] = next;
				}
			}
		}
	}

	internal static byte[] NormalizePng(byte[] bytes)
	{
		return NormalizePngWithWarnings(bytes).Png;
	}

	private static BitmapSource ValidatePng(byte[] bytes, bool canonical = false)
	{
		if (bytes.Length > 12582912 || bytes.Length < 45 || !bytes.AsSpan(0, 8).SequenceEqual(new byte[8] { 137, 80, 78, 71, 13, 10, 26, 10 }))
		{
			throw new InvalidDataException("皮肤必须是真正的 PNG 图片，不能将其他文件改后缀");
		}
		int num = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(16, 4));
		int num2 = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(20, 4));
		if (num < 1 || num2 < 1 || num > 4096 || num2 > 4096 || (long)num * (long)num2 > 16777216)
		{
			throw new InvalidDataException("PNG 超过安全像素限制：宽高须各不超过 4096 像素，总像素不超过 16,777,216");
		}
		bool flag = canonical;
		if (flag)
		{
			bool flag2 = num != num2;
			if (!flag2)
			{
				bool flag3 = ((num == 256 || num == 1024) ? true : false);
				flag2 = !flag3;
			}
			flag = flag2;
		}
		if (flag)
		{
			throw new InvalidDataException("本地皮肤尺寸无效，请重新导入原图");
		}
		int num3 = 8;
		bool flag4 = false;
		int num4 = 0;
		while (num3 + 12 <= bytes.Length && num4++ < 10000)
		{
			int num5 = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(num3, 4));
			if (num5 < 0 || num5 > bytes.Length - num3 - 12)
			{
				throw new InvalidDataException("PNG 数据损坏或不完整");
			}
			string text = Encoding.ASCII.GetString(bytes, num3 + 4, 4);
			if (num4 == 1 && (text != "IHDR" || num5 != 13))
			{
				throw new InvalidDataException("PNG 头部无效");
			}
			switch (text)
			{
			case "acTL":
			case "fcTL":
			case "fdAT":
				flag = true;
				break;
			default:
				flag = false;
				break;
			}
			if (flag)
			{
				throw new InvalidDataException("不支持动态 PNG，请生成 4×4 的静态精灵图集");
			}
			flag = canonical;
			if (flag)
			{
				bool flag2;
				switch (text)
				{
				case "IHDR":
				case "sRGB":
				case "gAMA":
				case "pHYs":
				case "IDAT":
				case "IEND":
					flag2 = true;
					break;
				default:
					flag2 = false;
					break;
				}
				flag = !flag2;
			}
			if (flag)
			{
				throw new InvalidDataException("本地皮肤包含未经归一化的数据，请重新导入原图");
			}
			uint num6 = uint.MaxValue;
			for (int i = num3 + 4; i < num3 + 8 + num5; i++)
			{
				num6 ^= bytes[i];
				for (int j = 0; j < 8; j++)
				{
					num6 = (num6 >> 1) ^ (uint)(((num6 & 1) != 0) ? (-306674912) : 0);
				}
			}
			if (~num6 != BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(num3 + num5 + 8, 4)))
			{
				throw new InvalidDataException("PNG 数据校验失败，请重新下载原图");
			}
			num3 += num5 + 12;
			if (text == "IEND")
			{
				flag4 = num5 == 0 && num3 == bytes.Length;
				break;
			}
		}
		if (!flag4)
		{
			throw new InvalidDataException("PNG 数据不完整或包含多余内容");
		}
		BitmapSource bitmapSource;
		try
		{
			bitmapSource = Decode(bytes);
		}
		catch (Exception ex) when (((ex is NotSupportedException || ex is COMException || ex is FileFormatException || ex is ArgumentException) ? 1 : 0) != 0)
		{
			throw new InvalidDataException("PNG 图片无法解码，请重新下载原始 PNG 文件", ex);
		}
		if (bitmapSource.PixelWidth != num || bitmapSource.PixelHeight != num2)
		{
			throw new InvalidDataException("PNG 图集尺寸不一致");
		}
		return bitmapSource;
	}

	private static byte[] ValidateCanonicalPng(byte[] bytes)
	{
		ValidatePng(bytes, canonical: true);
		return bytes;
	}

	internal static SkinNormalization NormalizePngWithWarnings(byte[] bytes)
	{
		BitmapSource bitmapSource = ValidatePng(bytes);
		int pixelWidth = bitmapSource.PixelWidth;
		int pixelHeight = bitmapSource.PixelHeight;
		if (pixelWidth == 256 && pixelHeight == 256)
		{
			return NormalizeLegacyPngWithWarnings(bytes);
		}
		List<string> list = new List<string>();
		if (pixelWidth != pixelHeight)
		{
			list.Add("原图不是正方形，已归一为 4×4 动作图集；角色比例或动作分格可能不准确。");
		}
		if (pixelWidth < 256 || pixelHeight < 256)
		{
			list.Add("原图尺寸较小，放大后可能模糊或缺少动作细节。");
		}
		byte[] array = new byte[pixelWidth * pixelHeight * 4];
		bitmapSource.CopyPixels(array, pixelWidth * 4, 0);
		for (int i = 0; i < array.Length; i += 4)
		{
			if (array[i + 3] <= 16)
			{
				Array.Clear(array, i, 4);
			}
			else if (array[i + 3] >= 239)
			{
				array[i + 3] = byte.MaxValue;
			}
		}
		List<(int, int, int, int)> list2 = new List<(int, int, int, int)>();
		for (int j = 0; j < 4; j++)
		{
			for (int k = 0; k < 4; k++)
			{
				ClearRecognisableBackground(array, pixelWidth, pixelHeight, j, k, list);
				ClearIsolatedNoise(array, pixelWidth, pixelHeight, j, k);
				int num = (k * pixelWidth + 3) / 4;
				int num2 = (j * pixelHeight + 3) / 4;
				int num3 = ((k + 1) * pixelWidth + 3) / 4;
				int num4 = ((j + 1) * pixelHeight + 3) / 4;
				int num5 = num3;
				int num6 = num4;
				int num7 = -1;
				int num8 = -1;
				int num9 = 0;
				int num10 = 0;
				for (int l = num2; l < num4; l++)
				{
					for (int m = num; m < num3; m++)
					{
						byte b = array[(l * pixelWidth + m) * 4 + 3];
						if (b == 0)
						{
							num10++;
							continue;
						}
						if (b > 128)
						{
							num9++;
						}
						num5 = Math.Min(num5, m);
						num6 = Math.Min(num6, l);
						num7 = Math.Max(num7, m);
						num8 = Math.Max(num8, l);
					}
				}
				if (num9 < 8)
				{
					list.Add($"第 {j + 1} 行第 {k + 1} 格为空或角色较小，该动作可能不可见。");
				}
				if (num10 == 0)
				{
					list.Add("部分动作格没有透明背景，已保留内容并自动补边，显示效果可能不同于预期。");
				}
				list2.Add((num7 < 0 || num8 < 0) ? (0, 0, 0, 0) : (num5, num6, num7 - num5 + 1, num8 - num6 + 1));
			}
		}
		int num11 = list2.Max<(int, int, int, int)>(((int Left, int Top, int Width, int Height) tuple2) => Math.Max(tuple2.Width, tuple2.Height));
		double num12 = ((num11 == 0) ? 1.0 : Math.Min(1.0, 240.0 / (double)num11));
		byte[] array2 = new byte[4194304];
		for (int num13 = 0; num13 < list2.Count; num13++)
		{
			(int, int, int, int) tuple = list2[num13];
			if (tuple.Item3 != 0 && tuple.Item4 != 0)
			{
				int num14 = Math.Max(1, (int)Math.Floor((double)tuple.Item3 * num12));
				int num15 = Math.Max(1, (int)Math.Floor((double)tuple.Item4 * num12));
				int targetLeft = num13 % 4 * 256 + (256 - num14) / 2;
				int targetTop = num13 / 4 * 256 + 244 - num15;
				ResampleFrame(array, pixelWidth, tuple.Item1, tuple.Item2, tuple.Item3, tuple.Item4, array2, targetLeft, targetTop, num14, num15);
			}
		}
		for (int num16 = 0; num16 < array2.Length; num16 += 4)
		{
			if (array2[num16 + 3] <= 16)
			{
				Array.Clear(array2, num16, 4);
			}
			else if (array2[num16 + 3] >= 239)
			{
				array2[num16 + 3] = byte.MaxValue;
			}
		}
		byte[] array3 = new byte[array2.Length];
		for (int num17 = 0; num17 < 4; num17++)
		{
			for (int num18 = 0; num18 < 4; num18++)
			{
				ClearIsolatedNoise(array2, 1024, 1024, num17, num18);
				int num19 = 256;
				int num20 = 256;
				int num21 = -1;
				int num22 = -1;
				for (int num23 = 0; num23 < 256; num23++)
				{
					for (int num24 = 0; num24 < 256; num24++)
					{
						if (array2[((num17 * 256 + num23) * 1024 + num18 * 256 + num24) * 4 + 3] > 0)
						{
							num19 = Math.Min(num19, num24);
							num20 = Math.Min(num20, num23);
							num21 = Math.Max(num21, num24);
							num22 = Math.Max(num22, num23);
						}
					}
				}
				if (num21 >= 0)
				{
					int num25 = (256 - (num21 - num19 + 1)) / 2;
					int num26 = 244 - (num22 - num20 + 1);
					for (int num27 = num20; num27 <= num22; num27++)
					{
						Array.Copy(array2, ((num17 * 256 + num27) * 1024 + num18 * 256 + num19) * 4, array3, ((num17 * 256 + num26 + num27 - num20) * 1024 + num18 * 256 + num25) * 4, (num21 - num19 + 1) * 4);
					}
				}
			}
		}
		BitmapSource bitmapSource2 = BitmapSource.Create(1024, 1024, 96.0, 96.0, PixelFormats.Bgra32, null, array3, 4096);
		bitmapSource2.Freeze();
		return new SkinNormalization(Encode(bitmapSource2), (list.Count == 0) ? Array.Empty<string>() : CleanWarnings(new string[1] { "文件不符合推荐标准，可能不达预期。" }.Concat(list)));
	}

	private static void ResampleFrame(byte[] source, int sourceStride, int sourceLeft, int sourceTop, int sourceWidth, int sourceHeight, byte[] target, int targetLeft, int targetTop, int targetWidth, int targetHeight)
	{
		for (int i = 0; i < targetHeight; i++)
		{
			for (int j = 0; j < targetWidth; j++)
			{
				double num = (double)j * (double)sourceWidth / (double)targetWidth;
				double num2 = ((double)j + 1.0) * (double)sourceWidth / (double)targetWidth;
				double num3 = (double)i * (double)sourceHeight / (double)targetHeight;
				double num4 = ((double)i + 1.0) * (double)sourceHeight / (double)targetHeight;
				double num5 = 0.0;
				double num6 = 0.0;
				double num7 = 0.0;
				double num8 = 0.0;
				for (int k = (int)num3; (double)k < Math.Ceiling(num4); k++)
				{
					for (int l = (int)num; (double)l < Math.Ceiling(num2); l++)
					{
						double num9 = (Math.Min(num2, (double)l + 1.0) - Math.Max(num, l)) * (Math.Min(num4, (double)k + 1.0) - Math.Max(num3, k));
						int num10 = ((sourceTop + k) * sourceStride + sourceLeft + l) * 4;
						double num11 = (double)(int)source[num10 + 3] * num9;
						num5 += num11;
						num6 += (double)(int)source[num10] * num11;
						num7 += (double)(int)source[num10 + 1] * num11;
						num8 += (double)(int)source[num10 + 2] * num11;
					}
				}
				int num12 = ((targetTop + i) * 1024 + targetLeft + j) * 4;
				if (!(num5 <= 0.0))
				{
					target[num12] = (byte)Math.Clamp(Math.Round(num6 / num5), 0.0, 255.0);
					target[num12 + 1] = (byte)Math.Clamp(Math.Round(num7 / num5), 0.0, 255.0);
					target[num12 + 2] = (byte)Math.Clamp(Math.Round(num8 / num5), 0.0, 255.0);
					target[num12 + 3] = (byte)Math.Clamp(Math.Round(num5 / ((num2 - num) * (num4 - num3))), 0.0, 255.0);
				}
			}
		}
	}

	private static SkinNormalization NormalizeLegacyPngWithWarnings(byte[] bytes)
	{
		if (bytes.Length > 12582912 || bytes.Length < 45 || !bytes.AsSpan(0, 8).SequenceEqual(new byte[8] { 137, 80, 78, 71, 13, 10, 26, 10 }))
		{
			throw new InvalidDataException("皮肤必须是真正的 PNG 图片，不能将其他文件改后缀");
		}
		int num = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(16, 4));
		int num2 = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(20, 4));
		if (num < 1 || num2 < 1 || num > 4096 || num2 > 4096 || (long)num * (long)num2 > 16777216)
		{
			throw new InvalidDataException("PNG 超过安全像素限制：宽高须各不超过 4096 像素，总像素不超过 16,777,216");
		}
		List<string> list = new List<string>();
		if (num != num2)
		{
			list.Add("原图不是正方形，已归一为 4×4 动作图集；角色比例或动作分格可能不准确。");
		}
		if (num < 256 || num2 < 256)
		{
			list.Add("原图尺寸较小，放大后可能模糊或缺少动作细节。");
		}
		int num3 = 8;
		bool flag = false;
		int num4 = 0;
		while (num3 + 12 <= bytes.Length && num4++ < 10000)
		{
			int num5 = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(num3, 4));
			if (num5 < 0 || num5 > bytes.Length - num3 - 12)
			{
				throw new InvalidDataException("PNG 数据损坏或不完整");
			}
			string text = Encoding.ASCII.GetString(bytes, num3 + 4, 4);
			if (num4 == 1 && (text != "IHDR" || num5 != 13))
			{
				throw new InvalidDataException("PNG 头部无效");
			}
			bool flag2;
			switch (text)
			{
			case "acTL":
			case "fcTL":
			case "fdAT":
				flag2 = true;
				break;
			default:
				flag2 = false;
				break;
			}
			if (flag2)
			{
				throw new InvalidDataException("不支持动态 PNG，请生成 4×4 的静态精灵图集");
			}
			num3 += num5 + 12;
			if (text == "IEND")
			{
				flag = num5 == 0 && num3 == bytes.Length;
				break;
			}
		}
		if (!flag)
		{
			throw new InvalidDataException("PNG 数据不完整或包含多余内容");
		}
		BitmapSource bitmapSource;
		try
		{
			bitmapSource = Decode(bytes);
		}
		catch (Exception ex) when (((ex is NotSupportedException || ex is COMException || ex is FileFormatException || ex is ArgumentException) ? 1 : 0) != 0)
		{
			throw new InvalidDataException("PNG 图片无法解码，请重新下载原始 PNG 文件", ex);
		}
		if (bitmapSource.PixelWidth != num || bitmapSource.PixelHeight != num2)
		{
			throw new InvalidDataException("PNG 图集尺寸不一致");
		}
		byte[] array = new byte[num * num2 * 4];
		bitmapSource.CopyPixels(array, num * 4, 0);
		for (int i = 0; i < array.Length; i += 4)
		{
			if (array[i + 3] <= 16)
			{
				Array.Clear(array, i, 4);
			}
			else if (array[i + 3] >= 239)
			{
				array[i + 3] = byte.MaxValue;
			}
		}
		for (int j = 0; j < 4; j++)
		{
			for (int k = 0; k < 4; k++)
			{
				ClearRecognisableBackground(array, num, num2, j, k, list);
			}
		}
		byte[] array2 = new byte[262144];
		for (int l = 0; l < 256; l++)
		{
			for (int m = 0; m < 256; m++)
			{
				int sourceIndex = ((int)(((double)l + 0.5) * (double)num2 / 256.0) * num + (int)(((double)m + 0.5) * (double)num / 256.0)) * 4;
				Array.Copy(array, sourceIndex, array2, (l * 256 + m) * 4, 4);
			}
		}
		List<(int, int, int, int)> list2 = new List<(int, int, int, int)>();
		for (int n = 0; n < 4; n++)
		{
			for (int num6 = 0; num6 < 4; num6++)
			{
				ClearIsolatedNoise(array2, 256, 256, n, num6, legacy: true);
				int num7 = 0;
				int num8 = 0;
				int num9 = 64;
				int num10 = 64;
				int num11 = -1;
				int num12 = -1;
				for (int num13 = 0; num13 < 64; num13++)
				{
					for (int num14 = 0; num14 < 64; num14++)
					{
						byte b = array2[((n * 64 + num13) * 256 + num6 * 64 + num14) * 4 + 3];
						if (b == 0)
						{
							num8++;
							continue;
						}
						if (b > 128)
						{
							num7++;
						}
						num9 = Math.Min(num9, num14);
						num10 = Math.Min(num10, num13);
						num11 = Math.Max(num11, num14);
						num12 = Math.Max(num12, num13);
					}
				}
				if (num7 < 8)
				{
					list.Add($"第 {n + 1} 行第 {num6 + 1} 格为空或角色较小，该动作可能不可见。");
				}
				if (num8 == 0)
				{
					list.Add("部分动作格没有透明背景，已保留内容并自动补边，显示效果可能不同于预期。");
				}
				list2.Add((num11 < 0 || num12 < 0) ? (0, 0, 0, 0) : (num9, num10, num11 - num9 + 1, num12 - num10 + 1));
			}
		}
		int num15 = list2.Max<(int, int, int, int)>(((int Left, int Top, int Width, int Height) tuple2) => Math.Max(tuple2.Width, tuple2.Height));
		double num16 = ((num15 == 0) ? 1.0 : Math.Min(1.0, 60.0 / (double)num15));
		byte[] array3 = new byte[array2.Length];
		for (int num17 = 0; num17 < list2.Count; num17++)
		{
			(int, int, int, int) tuple = list2[num17];
			int num18 = num17 % 4;
			int num19 = num17 / 4;
			if (tuple.Item3 == 0 || tuple.Item4 == 0)
			{
				continue;
			}
			int num20 = Math.Max(1, (int)Math.Floor((double)tuple.Item3 * num16));
			int num21 = Math.Max(1, (int)Math.Floor((double)tuple.Item4 * num16));
			int num22 = (64 - num20) / 2;
			int num23 = 61 - num21;
			for (int num24 = 0; num24 < num21; num24++)
			{
				for (int num25 = 0; num25 < num20; num25++)
				{
					int num26 = num18 * 64 + tuple.Item1 + Math.Min(tuple.Item3 - 1, (int)(((double)num25 + 0.5) * (double)tuple.Item3 / (double)num20));
					int num27 = num19 * 64 + tuple.Item2 + Math.Min(tuple.Item4 - 1, (int)(((double)num24 + 0.5) * (double)tuple.Item4 / (double)num21));
					int num28 = num18 * 64 + num22 + num25;
					int num29 = num19 * 64 + num23 + num24;
					Array.Copy(array2, (num27 * 256 + num26) * 4, array3, (num29 * 256 + num28) * 4, 4);
				}
			}
		}
		BitmapSource bitmapSource2 = BitmapSource.Create(256, 256, 96.0, 96.0, PixelFormats.Bgra32, null, array3, 1024);
		bitmapSource2.Freeze();
		return new SkinNormalization(Encode(bitmapSource2), (list.Count == 0) ? Array.Empty<string>() : CleanWarnings(new string[1] { "文件不符合推荐标准，可能不达预期。" }.Concat(list)));
	}
}
