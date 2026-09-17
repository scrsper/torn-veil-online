using UnrealBuildTool;
public class TornVeilOnline : ModuleRules {
    public TornVeilOnline(ReadOnlyTargetRules Target) : base(Target) {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore", "WebSockets", "Json", "JsonUtilities", "UMG", "PCG", "ProceduralMeshComponent", "AnimGraphRuntime", "AnimationCore" });
        PublicDependencyModuleNames.AddRange(new string[] { "EnhancedInput", "CommonUI", "CommonInput", "Slate", "SlateCore" });
        if (Target.bBuildEditor) PrivateDependencyModuleNames.Add("ApplicationCore"); // native keyboard acceptance
        if (Target.bBuildEditor) PrivateDependencyModuleNames.AddRange(new string[] { "UnrealEd", "MovieSceneCapture", "ImageWrapper", "RenderCore" }); // editor-only PIE evidence capture
        PrivateDependencyModuleNames.Add("ImageCore"); // completed Lit-frame acceptance readback
        RuntimeDependencies.Add("$(ProjectDir)/Content/TornVeil/Presentation/EnvironmentPalette.json", StagedFileType.NonUFS);
    }
}
