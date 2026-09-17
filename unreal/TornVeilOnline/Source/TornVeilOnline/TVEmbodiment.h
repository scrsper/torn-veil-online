#pragma once

#include "CoreMinimal.h"
#include "Components/SkeletalMeshComponent.h"
#include "TVEmbodiment.generated.h"

class FJsonObject;
class UAnimationAsset;
class USkeletalMesh;
class UAnimInstance;

/**
 * Slice 3 embodiment: the renderer half of "canonical people look like people".
 *
 * The bridge sends a *semantic* appearance profile and a *semantic* activity presentation —
 * `apron_smith`, `hair_tied_back`, `work`/`forge`, `seat` — and never an asset path, because
 * canonical simulation must not know an engine exists (AGENTS.md §3). This file is the only
 * place that turns those tokens into installed content, and it does it through a catalogue
 * asset under `Content/TornVeil/Presentation/`, not through code. Swapping the installed human
 * library is therefore a content edit; no C++ and no simulation changes.
 */

/** One resolved semantic slot from the bridge. `Token` is presentation vocabulary. */
USTRUCT()
struct FTVAppearanceSlot {
    GENERATED_BODY()
    UPROPERTY() FString Kind;
    UPROPERTY() FString Token;
    /** Canonical colour for this slot, or 0 with bHasTint false when the simulation carries none. */
    UPROPERTY() int64 Tint = 0;
    UPROPERTY() bool bHasTint = false;
};

/** The full profile for one canonical person, as projected onto one of its bodies. */
USTRUCT()
struct FTVAppearanceProfile {
    GENERATED_BODY()
    UPROPERTY() FString PersonId;
    UPROPERTY() FString BodyId;
    UPROPERTY() FString Species;
    UPROPERTY() FString Sex;
    UPROPERTY() FString LifeStage;
    /** Non-empty for an AUTHORED character; empty for a MODULAR one. */
    UPROPERTY() FString CharacterKey;
    UPROPERTY() bool bAuthored = false;
    UPROPERTY() float Height = 1.f;
    UPROPERTY() float Build = 1.f;
    /** Stable content hash. The bridge sends a full profile only when this changes. */
    UPROPERTY() FString Signature;
    UPROPERTY() TArray<FTVAppearanceSlot> Slots;

    /** Fails closed: a profile without identity or without slots is rejected, not defaulted. */
    static bool Parse(const TSharedPtr<FJsonObject>& Json, FTVAppearanceProfile& Out, FString& Error);
    const FTVAppearanceSlot* FindSlot(const TCHAR* Kind) const;
};

/** The canonical activity, already resolved into a presentation family by the bridge. */
USTRUCT()
struct FTVActivityPresentation {
    GENERATED_BODY()
    UPROPERTY() FString Family;
    UPROPERTY() FString Detail;
    UPROPERTY() FString Posture;
    UPROPERTY() FString Locomotion;
    UPROPERTY() FString Station;
    UPROPERTY() FString PlaceId;
    UPROPERTY() FString FacingEntityId;
    UPROPERTY() FString Carried;
    UPROPERTY() float Speed = 0.f;
    /** Canonical injury consequence, exposed rather than recomputed. */
    UPROPERTY() bool bImpaired = false;
    UPROPERTY() float InjurySeverity = 0.f;
    UPROPERTY() float MovementMultiplier = 1.f;

    static bool Parse(const TSharedPtr<FJsonObject>& Json, FTVActivityPresentation& Out, FString& Error);
};

/** A physically valid position the bridge chose for this body inside a canonical place. */
USTRUCT()
struct FTVStationPresentation {
    GENERATED_BODY()
    UPROPERTY() bool bValid = false;
    UPROPERTY() FString SlotId;
    UPROPERTY() FString Kind;
    UPROPERTY() FString Posture;
    /** Canonical metres, unconverted — the caller applies the project's unitsPerMetre. */
    UPROPERTY() FVector StandMetres = FVector::ZeroVector;
    UPROPERTY() float Yaw = 0.f;
    UPROPERTY() float SettleMetres = 0.f;

    static bool Parse(const TSharedPtr<FJsonObject>& Json, FTVStationPresentation& Out);
};

/** Everything the bridge says about how one body should be embodied this snapshot. */
USTRUCT()
struct FTVEmbodimentState {
    GENERATED_BODY()
    UPROPERTY() FString AppearanceSignature;
    /** Present only on the snapshot where the signature changed. */
    UPROPERTY() bool bHasAppearance = false;
    UPROPERTY() FTVAppearanceProfile Appearance;
    UPROPERTY() FTVActivityPresentation Activity;
    UPROPERTY() FTVStationPresentation Station;
    /** Bounded presentation-only offsets, canonical metres. Never fed back to simulation. */
    UPROPERTY() FVector2D Separation = FVector2D::ZeroVector;
    UPROPERTY() bool bHasConversation = false;
    UPROPERTY() FVector ConversationStandMetres = FVector::ZeroVector;
    UPROPERTY() float ConversationYaw = 0.f;

    static bool Parse(const TSharedPtr<FJsonObject>& Json, FTVEmbodimentState& Out, FString& Error);
};

/**
 * Token → installed content, loaded from `Content/TornVeil/Presentation/CharacterPalette.json`.
 *
 * Every path in the palette is a machine-local content path. The file is deliberately data, not
 * code: a developer whose library differs edits JSON, and nothing in the simulation, the bridge
 * or this module changes. A token the palette cannot satisfy resolves to nothing and the
 * character keeps the driver silhouette for that slot — a missing asset must never be reported
 * as a resolved one.
 */
UCLASS()
class TORNVEILONLINE_API UTVCharacterPalette : public UObject {
    GENERATED_BODY()
public:
    /** Loads (once) and returns the palette. Never null; an absent file yields an empty palette. */
    static UTVCharacterPalette* Get();

    /** Re-reads the palette file. Exposed so an editor/automation run can iterate without a restart. */
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Embodiment") bool Reload();

    /** The whole-character mesh for an authored character key, or null. */
    USkeletalMesh* AuthoredMesh(const FString& CharacterKey) const;
    /** The body mesh a modular profile should build on, or null. */
    USkeletalMesh* BodyMesh(const FString& Token) const;
    /** A modular part mesh for a slot token, or null. */
    USkeletalMesh* PartMesh(const FString& Kind, const FString& Token) const;
    /** The activity clip for `family/detail`, falling back to `family`, else null. */
    UAnimationAsset* ActivityAnimation(const FString& Family, const FString& Detail) const;
    /** Retarget animation blueprint for a visible skeleton that is not the driver's, or null. */
    UClass* RetargetAnimClass(const FString& SkeletonKey) const;
    /** True when the palette declares this visible skeleton identical to the driver skeleton,
     * so the visible mesh can share the driver pose instead of retargeting. */
    bool SharesDriverSkeleton(const FString& SkeletonKey) const;

    /** What the palette actually resolved, for evidence reporting. Never a success claim on its own. */
    UFUNCTION(BlueprintPure, Category = "Torn Veil|Embodiment") FString PaletteDiagnostics() const;

private:
    void Ingest(const TSharedPtr<FJsonObject>& Root);
    UPROPERTY() TMap<FString, FString> AuthoredPaths;
    UPROPERTY() TMap<FString, FString> BodyPaths;
    /** Keyed `kind/token`. */
    UPROPERTY() TMap<FString, FString> PartPaths;
    /** Keyed `family/detail` and `family`. */
    UPROPERTY() TMap<FString, FString> ActivityPaths;
    UPROPERTY() TMap<FString, FString> RetargetClassPaths;
    UPROPERTY() TSet<FString> DriverSkeletons;
    FString SourceFile;
    bool bLoaded = false;
    int32 MissingLookups = 0;
    mutable TSet<FString> UnresolvedTokens;
};

/**
 * The visible character for one ATVCharacter.
 *
 * Architecture required by the slice, and the reason the working Manny/GASP driver is kept:
 *
 *     canonical person/body → ATVCharacter → hidden animation driver (GetMesh())
 *                                          → visible character presentation (this component)
 *
 * The driver keeps every existing behaviour — locomotion blend space, sprint, directional
 * transitions, crouch, attack/hit/downed replay, `AlwaysTickPoseAndRefreshBones` — and simply
 * stops being drawn. The visible mesh either shares the driver's pose outright
 * (`SetLeaderPoseComponent`, when the palette declares the same skeleton) or runs a retarget
 * animation blueprint that reads the driver through an IK Retargeter. Modular parts are leader-
 * posed to the visible body, so a full outfit costs one animation evaluation, not one per part.
 */
UCLASS(ClassGroup = (TornVeil), meta = (BlueprintSpawnableComponent))
class TORNVEILONLINE_API UTVCharacterPresentation : public USkeletalMeshComponent {
    GENERATED_BODY()
public:
    UTVCharacterPresentation();

    /** Binds this presentation to the hidden driver and hides the driver. Safe to call twice. */
    void BindDriver(USkeletalMeshComponent* Driver);

    /** Rebuilds the visible character. A no-op when the signature is unchanged, so this is safe
     * to call every snapshot. Returns true when something was actually rebuilt. */
    bool ApplyProfile(const FTVAppearanceProfile& Profile);

    /** Applies canonical colour tints to whatever material slots the resolved meshes expose. */
    void ApplyTints(const FTVAppearanceProfile& Profile);

    /** True once a real character mesh (authored or modular body) is being drawn. While false the
     * driver stays visible, so a machine without the content still sees a person rather than
     * nothing — and the diagnostics say so rather than claiming success. */
    UFUNCTION(BlueprintPure, Category = "Torn Veil|Embodiment") bool HasVisibleCharacter() const { return bVisibleCharacter; }

    UFUNCTION(BlueprintPure, Category = "Torn Veil|Embodiment") FString EmbodimentDiagnostics() const;

private:
    void ClearParts();
    UPROPERTY() TObjectPtr<USkeletalMeshComponent> DriverMesh;
    UPROPERTY() TArray<TObjectPtr<USkeletalMeshComponent>> Parts;
    /** Parallel to `Parts`: which appearance slot each built part came from, so a tint reaches the
     * part it belongs to rather than whichever part happens to share its index in the profile. */
    UPROPERTY() TArray<FString> PartSlotKinds;
    FString AppliedSignature;
    FString ResolvedCharacterKey;
    bool bVisibleCharacter = false;
    bool bRetargeted = false;
    int32 ResolvedPartCount = 0;
    int32 UnresolvedSlotCount = 0;
};
