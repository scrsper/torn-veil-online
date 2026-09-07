using UnrealBuildTool;
public class TornVeilOnlineEditorTarget : TargetRules {
    public TornVeilOnlineEditorTarget(TargetInfo Target) : base(Target) {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V7;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;
        ExtraModuleNames.Add("TornVeilOnline");
    }
}
