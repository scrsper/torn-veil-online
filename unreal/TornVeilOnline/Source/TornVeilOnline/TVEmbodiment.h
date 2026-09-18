#pragma once

#include "CoreMinimal.h"
#include "Components/SkeletalMeshComponent.h"
#include "TVEmbodiment.generated.h"

class FJsonObject;
class UAnimationAsset;
class USkeletalMesh;

/**
 * Renderer-side embodiment for canonical people.
 *
 * The bridge no longer invents a second semantic appearance. It projects
 * `Person.appearance.description`, runs the shared Character Foundry against the machine-local
 * audited catalogue, and sends the resulting asset configuration here. Package paths exist only
 * in that disposable presentation result; canonical simulation never contains them.
 */

/** One concrete part selected by the Character Foundry. */
USTRUCT()
struct FTVFoundrySlot {
    GENERATED_BODY()
    UPROPERTY() FString Slot;
    UPROPERTY() FString Package;
    UPROPERTY() FString Name;
    UPROPERTY() FString AssetClass;
    UPROPERTY() TArray<FString> MaterialSlots;
};

/** Renderer material inputs derived by the Foundry from canonical appearance. */
USTRUCT()
struct FTVAppearanceMaterials {
    GENERATED_BODY()
    UPROPERTY() int64 Skin = 0;
    UPROPERTY() int64 Hair = 0;
    UPROPERTY() int64 GarmentPrimary = 0;
    UPROPERTY() int64 GarmentSecondary = 0;
    UPROPERTY() int64 GarmentAccent = 0;
    UPROPERTY() float Wear = 0.f;
    UPROPERTY() float Grooming = 1.f;
};

/** Canonical description plus its machine-local Character Foundry realization. */
USTRUCT()
struct FTVAppearanceProfile {
    GENERATED_BODY()
    UPROPERTY() FString PersonId;
    UPROPERTY() FString BodyId;
    UPROPERTY() FString Signature;
    UPROPERTY() FString Skeleton;
    UPROPERTY() bool bComplete = false;
    UPROPERTY() float Height = 1.f;
    UPROPERTY() float Build = 1.f;
    UPROPERTY() FTVAppearanceMaterials Materials;
    UPROPERTY() TMap<FString, float> Morphs;
    UPROPERTY() TArray<FTVFoundrySlot> Slots;
    UPROPERTY() int32 ProblemCount = 0;

    /** Fails closed on malformed identity/realization data; an empty realization is valid fallback. */
    static bool Parse(const TSharedPtr<FJsonObject>& Json, FTVAppearanceProfile& Out, FString& Error);
    const FTVFoundrySlot* FindSlot(const TCHAR* Slot) const;
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
    UPROPERTY() bool bHasAppearance = false;
    UPROPERTY() FTVAppearanceProfile Appearance;
    UPROPERTY() FTVActivityPresentation Activity;
    UPROPERTY() FTVStationPresentation Station;
    UPROPERTY() FVector2D Separation = FVector2D::ZeroVector;
    UPROPERTY() bool bHasConversation = false;
    UPROPERTY() FVector ConversationStandMetres = FVector::ZeroVector;
    UPROPERTY() float ConversationYaw = 0.f;

    static bool Parse(const TSharedPtr<FJsonObject>& Json, FTVEmbodimentState& Out, FString& Error);
};

/**
 * Local animation support data. Character meshes and parts are selected only by the shared
 * Character Foundry; this file retains presentation-only activity clips and generated retarget
 * AnimBlueprint classes because those are Unreal execution details, not appearance truth.
 */
UCLASS()
class TORNVEILONLINE_API UTVCharacterPalette : public UObject {
    GENERATED_BODY()
public:
    static UTVCharacterPalette* Get();
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Embodiment") bool Reload();
    UAnimationAsset* ActivityAnimation(const FString& Family, const FString& Detail) const;
    UClass* RetargetAnimClass(const FString& SkeletonKey) const;
    bool SharesDriverSkeleton(const FString& SkeletonKey) const;
    UFUNCTION(BlueprintPure, Category = "Torn Veil|Embodiment") FString PaletteDiagnostics() const;

private:
    void Ingest(const TSharedPtr<FJsonObject>& Root);
    UPROPERTY() TMap<FString, FString> ActivityPaths;
    UPROPERTY() TMap<FString, FString> RetargetClassPaths;
    UPROPERTY() TSet<FString> DriverSkeletons;
    FString SourceFile;
    bool bLoaded = false;
    mutable TSet<FString> UnresolvedTokens;
};

/**
 * Visible body driven by the existing hidden Manny/GASP component. Resolved skeletal parts share
 * its pose; a foreign body uses the generated retarget AnimBlueprint. Unsupported or missing
 * assets fail soft to the driver silhouette and are reported in diagnostics.
 */
UCLASS(ClassGroup = (TornVeil), meta = (BlueprintSpawnableComponent))
class TORNVEILONLINE_API UTVCharacterPresentation : public USkeletalMeshComponent {
    GENERATED_BODY()
public:
    UTVCharacterPresentation();
    void BindDriver(USkeletalMeshComponent* Driver);
    bool ApplyProfile(const FTVAppearanceProfile& Profile);
    void ApplyTints(const FTVAppearanceProfile& Profile);
    UFUNCTION(BlueprintPure, Category = "Torn Veil|Embodiment") bool HasVisibleCharacter() const { return bVisibleCharacter; }
    UFUNCTION(BlueprintPure, Category = "Torn Veil|Embodiment") FString EmbodimentDiagnostics() const;

private:
    void ClearParts();
    UPROPERTY() TObjectPtr<USkeletalMeshComponent> DriverMesh;
    UPROPERTY() TArray<TObjectPtr<USkeletalMeshComponent>> Parts;
    UPROPERTY() TArray<FString> PartSlotKinds;
    FString AppliedSignature;
    bool bVisibleCharacter = false;
    bool bRetargeted = false;
    bool bFoundryComplete = false;
    int32 FoundryProblemCount = 0;
    int32 ResolvedPartCount = 0;
    int32 UnresolvedSlotCount = 0;
};
