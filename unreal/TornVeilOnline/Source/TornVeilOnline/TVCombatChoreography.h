#pragma once
#include "CoreMinimal.h"

/** Wire inputs are execution facts. No rules for reach, damage, death, intent or learning. */
struct FTVCombatEvent {
    int64 Seq = 0, AttackSeq = 0, HitSeq = 0;
    FString EventId, ActorBodyId, TargetBodyId, WeaponType, WeaponId, Outcome;
    FVector ActorPosition = FVector::ZeroVector, TargetPosition = FVector::ZeroVector, TargetVelocity = FVector::ZeroVector;
    float ActorYaw = 0, PhysicalTime = 0, Strength = .5f, Dexterity = .5f, Exertion = 1;
    // Extension inputs below are only accepted on explicitly labeled presentation fixtures.
    bool bFixture = false;
    FString TechniqueId, LineageId, MagicDomain;
    float Mastery = 0;
    bool bHasMastery = false;
    static bool Parse(const TSharedPtr<class FJsonObject>& Json, FTVCombatEvent& Out);
};

struct FTVCombatStyleProfile {
    float Force = 0, Control = 0, Economy = 0, Recovery = 0;
    int32 Complexity = 0;
    static FTVCombatStyleProfile From(const FTVCombatEvent& Event);
};
struct FTVTechniqueVisualSignature {
    uint32 Seed = 0;
    int32 Motif = 0;
    float RotationBias = 0, Rhythm = 1;
    FLinearColor Colour = FLinearColor(.58f, .72f, .85f);
    static FTVTechniqueVisualSignature From(const FTVCombatEvent& Event);
};
struct FTVMotionPrimitive {
    FString Id, Family, AssetPath, Effector;
    float ContactTime = .3f, Length = .8f, ReachCm = 75, LateralCm = 0;
    float MinControl = 0, MaxControl = 1;
};
struct FTVPresentationFXCue {
    float Trail = 0, Impact = 0, HitStop = 0, Camera = 0;
    bool bMagicFixture = false;
    FLinearColor Colour;
};
struct FTVChoreographyRequest {
    FTVCombatEvent Event;
    int32 LOD = 0;
    float ActorScale = 1;
    bool bReaction = false;
};
struct FTVChoreographyPlan {
    FTVCombatStyleProfile Style;
    FTVTechniqueVisualSignature Signature;
    FTVMotionPrimitive Motion;
    FTVPresentationFXCue FX;
    FString WeaponFamily;
    float Anticipation = .2f, Strike = .14f, Recovery = .35f, ContactAt = .34f, Duration = .8f;
    float AlignmentYaw = 0, PivotYaw = 0, LeanDegrees = 0, LeanYaw = 0, OffsetLimitCm = 22, ContactErrorCm = 0;
    FVector ContactOffset = FVector::ZeroVector;
    int32 LOD = 0;
    bool bReaction = false;
    float SampleTime(float Age) const;
    float Weight(float Age) const;
    FVector Offset(float Age) const;
    float Yaw(float Age) const;
    float Lean(float Age) const;
};
/** Pure planner, loaded once from an owned catalog. Inputs cannot write back to a body. */
class TORNVEILONLINE_API FTVCombatChoreographer {
public:
    static uint32 StableHash(const FString& Text);
    static FTVChoreographyPlan Plan(const FTVChoreographyRequest& Request);
    static const TArray<FTVMotionPrimitive>& Primitives();
    static FString WeaponFamily(const FString& Type);
};

/** Snapshot replay cursor. Global gaps between visible events are expected; retention loss
 * is measured separately. A new connection establishes a baseline, never replays old fights. */
struct TORNVEILONLINE_API FTVCombatReplayCursor {
    int64 Latest = 0, LastDispatched = 0, RetentionGap = 0, Duplicates = 0, Invalid = 0, Late = 0;
    bool bInitialized = false;
    TMap<int64, FString> Seen;
    TArray<FTVCombatEvent> Read(const TSharedPtr<FJsonObject>& Stream);
};
