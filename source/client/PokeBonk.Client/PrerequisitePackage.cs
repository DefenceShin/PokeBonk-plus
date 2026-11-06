using System.Runtime.CompilerServices;
using System.Text;

namespace PokeBonk.Client;

internal sealed record PrerequisitePackage(string FileName, long Bytes, string Sha256, string Version, string SignerThumbprint, string Source, string Architecture = "x64", string ManifestFileName = "manifest.json")
{
	internal bool IsOfficial
	{
		get
		{
			if (!(this == Official))
			{
				return this == OfficialArm64;
			}
			return true;
		}
	}

	internal static readonly PrerequisitePackage Official = new PrerequisitePackage("MicrosoftEdgeWebView2RuntimeInstallerX64.exe", 214156024L, "0625fb5c1e75be58a164e14f95aa58a3e5badb859b3d17c952385f3e4a9ff3e8", "1.3.287.9", "21CA9DD6DA7C57C3A599880D17317D7BDA31899C", "https://go.microsoft.com/fwlink/?linkid=2124701");

	internal static readonly PrerequisitePackage OfficialArm64 = new PrerequisitePackage("MicrosoftEdgeWebView2RuntimeInstallerARM64.exe", 218193104L, "69d82973e5cde2438946ff8d806845157416ccdaed0c03962845db2c3d775f77", "1.3.299.15", "4028CAD637509D4744B17EC5B42AED8D7A31E6AF", "https://go.microsoft.com/fwlink/?linkid=2099616", "arm64", "manifest-arm64.json");

	internal static PrerequisitePackage ForSystem(PrerequisiteSystem system)
	{
		if (!(system.RuntimeArchitecture == "arm64"))
		{
			return Official;
		}
		return OfficialArm64;
	}

	[CompilerGenerated]
	private bool PrintMembers(StringBuilder builder)
	{
		RuntimeHelpers.EnsureSufficientExecutionStack();
		builder.Append("FileName = ");
		builder.Append((object?)FileName);
		builder.Append(", Bytes = ");
		builder.Append(Bytes.ToString());
		builder.Append(", Sha256 = ");
		builder.Append((object?)Sha256);
		builder.Append(", Version = ");
		builder.Append((object?)Version);
		builder.Append(", SignerThumbprint = ");
		builder.Append((object?)SignerThumbprint);
		builder.Append(", Source = ");
		builder.Append((object?)Source);
		builder.Append(", Architecture = ");
		builder.Append((object?)Architecture);
		builder.Append(", ManifestFileName = ");
		builder.Append((object?)ManifestFileName);
		return true;
	}

	[CompilerGenerated]
	private PrerequisitePackage(PrerequisitePackage original)
	{
		FileName = original.FileName;
		Bytes = original.Bytes;
		Sha256 = original.Sha256;
		Version = original.Version;
		SignerThumbprint = original.SignerThumbprint;
		Source = original.Source;
		Architecture = original.Architecture;
		ManifestFileName = original.ManifestFileName;
	}
}
