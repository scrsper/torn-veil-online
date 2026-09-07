using UnrealBuildTool;
public class TornVeilOnlineTarget : TargetRules {
    public TornVeilOnlineTarget(TargetInfo Target) : base(Target) {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V7;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;
        ExtraModuleNames.Add("TornVeilOnline");
    }
}
