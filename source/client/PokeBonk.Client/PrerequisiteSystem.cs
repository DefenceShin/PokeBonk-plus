using System;
using System.Runtime.InteropServices;

namespace PokeBonk.Client;

public sealed record PrerequisiteSystem(bool IsWindows, Architecture Architecture, Version Version, bool IsLtscOrServer = false, Architecture? ProcessArchitectureOverride = null)
{
	public Architecture ProcessArchitecture => ProcessArchitectureOverride ?? RuntimeInformation.ProcessArchitecture;

	public bool Supported
	{
		get
		{
			if (IsWindows && ProcessArchitecture == Architecture.X64 && Version.Major >= 10)
			{
				if (Architecture != Architecture.X64 || (Version.Build < 16299 && (Version.Build < 14393 || !IsLtscOrServer)))
				{
					if (Architecture == Architecture.Arm64)
					{
						return Version.Build >= 22000;
					}
					return false;
				}
				return true;
			}
			return false;
		}
	}

	public string RuntimeArchitecture
	{
		get
		{
			if (Architecture != Architecture.Arm64)
			{
				return "x64";
			}
			return "arm64";
		}
	}
}
