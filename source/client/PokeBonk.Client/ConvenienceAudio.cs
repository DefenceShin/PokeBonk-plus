using System;
using System.IO;
using System.Linq;
using System.Text;

namespace PokeBonk.Client;

internal static class ConvenienceAudio
{
	internal const int SampleRate = 16000;

	internal static byte[] Wave(string tone, int volume)
	{
		bool flag = !ConvenienceSettings.Tones.Contains(tone);
		if (!flag)
		{
			bool flag2 = ((volume < 0 || volume > 100) ? true : false);
			flag = flag2;
		}
		if (flag)
		{
			throw new InvalidOperationException("提醒音类型或音量无效。");
		}
		double num = ((tone == "bell") ? 0.42 : 0.32);
		int num2 = (int)(16000.0 * num);
		using MemoryStream memoryStream = new MemoryStream(44 + num2 * 2);
		using BinaryWriter binaryWriter = new BinaryWriter(memoryStream, Encoding.ASCII, leaveOpen: true);
		binaryWriter.Write(Encoding.ASCII.GetBytes("RIFF"));
		binaryWriter.Write(36 + num2 * 2);
		binaryWriter.Write(Encoding.ASCII.GetBytes("WAVEfmt "));
		binaryWriter.Write(16);
		binaryWriter.Write((short)1);
		binaryWriter.Write((short)1);
		binaryWriter.Write(16000);
		binaryWriter.Write(32000);
		binaryWriter.Write((short)2);
		binaryWriter.Write((short)16);
		binaryWriter.Write(Encoding.ASCII.GetBytes("data"));
		binaryWriter.Write(num2 * 2);
		for (int i = 0; i < num2; i++)
		{
			double num3 = (double)i / 16000.0;
			double num4 = num3 / num;
			double num5 = Math.Min(1.0, num3 / 0.012) * Math.Pow(1.0 - num4, 2.0);
			binaryWriter.Write((short)Math.Round(Math.Clamp(tone switch
			{
				"bell" => Math.Sin(Math.PI * 1760.0 * num3) + 0.3 * Math.Sin(Math.PI * 2640.0 * num3), 
				"soft" => Math.Sin(Math.PI * 880.0 * num3), 
				"pulse" => Math.Sin(Math.PI * 1320.0 * num3) * (double)((num3 % 0.16 < 0.1) ? 1 : 0), 
				_ => Math.Sin(Math.PI * 2.0 * (double)((num3 < 0.14) ? 660 : 880) * num3), 
			} * num5 * (double)volume / 100.0 * 12000.0, -32768.0, 32767.0)));
		}
		binaryWriter.Flush();
		return memoryStream.ToArray();
	}
}
