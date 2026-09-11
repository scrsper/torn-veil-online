#pragma once

#include "CoreMinimal.h"

class FJsonObject;

struct FTVAppearanceVisualState {
    bool bPresent = false;
    uint32 Skin = 0xd9a988, Shirt = 0x8a6a4a, Hair = 0x4a2f1a;
    float Height = 1.f, Build = 1.f;
    FString HatStyle;
};

/** Validated, presentation-only projection of one canonical body. */
struct FTVHumanoidVisualState {
    FString BodyId;
    FString EntityId;
    FString Name;
    FString Activity;
    FString Pose;
    FVector Position = FVector::ZeroVector;
    FVector Velocity = FVector::ZeroVector;
    float Yaw = 0.f;
    float Speed = 0.f;
    double LastAttackAt = -99.0;
    double LastHitAt = -99.0;
    int64 AttackSeq = 0;
    int64 HitSeq = 0;
    bool bDead = false;
    bool bIncapacitated = false;
    FTVAppearanceVisualState Appearance;

    /** Required identity/transform fields fail closed; optional presentation fields use defaults. */
    static bool Parse(const TSharedPtr<FJsonObject>& Json, FTVHumanoidVisualState& Out, FString& Error);
    /** Returns the bounded number of new one-shot events to enqueue for a snapshot delta. */
    static int32 PendingDelta(int64 Previous, int64 Current, int32 AlreadyPending);
};
