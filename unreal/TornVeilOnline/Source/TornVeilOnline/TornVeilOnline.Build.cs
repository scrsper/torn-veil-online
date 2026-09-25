using UnrealBuildTool;
public class TornVeilOnline : ModuleRules {
    public TornVeilOnline(ReadOnlyTargetRules Target) : base(Target) {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore", "WebSockets", "Json", "JsonUtilities", "UMG", "PCG", "ProceduralMeshComponent", "AnimGraphRuntime", "AnimationCore" });
        PublicDependencyModuleNames.AddRange(new string[] { "EnhancedInput", "CommonUI", "CommonInput", "Slate", "SlateCore" });
        PrivateDependencyModuleNames.Add("HairStrandsCore"); // installed, bound hair cards on modular faces
        if (Target.bBuildEditor) PrivateDependencyModuleNames.Add("ApplicationCore"); // native keyboard acceptance
        if (Target.bBuildEditor) PrivateDependencyModuleNames.AddRange(new string[] { "UnrealEd", "MovieSceneCapture", "ImageWrapper", "RenderCore", "MeshDescription", "StaticMeshDescription" }); // editor-only PIE evidence capture
        if (Target.bBuildEditor) PrivateDependencyModuleNames.AddRange(new string[] { "AnimGraph", "BlueprintGraph", "IKRig", "IKRigDeveloper" }); // reproducible local Foundry pose blueprints
        PrivateDependencyModuleNames.Add("ImageCore"); // completed Lit-frame acceptance readback
        // JSON read with FFileHelper at runtime (palettes, appearance grammar, the machine-local
        // CharacterPalette.local.json when present, combat motion data) must be staged loose.
        RuntimeDependencies.Add("$(ProjectDir)/Content/TornVeil/Presentation/*.json", StagedFileType.NonUFS);
        RuntimeDependencies.Add("$(ProjectDir)/Content/TornVeil/Combat/Data/*.json", StagedFileType.NonUFS);
    }
}
