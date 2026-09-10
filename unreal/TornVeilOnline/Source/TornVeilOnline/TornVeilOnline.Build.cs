using UnrealBuildTool;
public class TornVeilOnline : ModuleRules {
    public TornVeilOnline(ReadOnlyTargetRules Target) : base(Target) {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore", "WebSockets", "Json", "JsonUtilities", "UMG", "PCG", "ProceduralMeshComponent" });
    }
}
