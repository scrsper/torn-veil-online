#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TVWildlifePresentation.generated.h"

class UAnimationAsset;
class USkeletalMeshComponent;

/**
 * Disposable manifestation of one canonical wildlife body.
 *
 * This actor has no AI, collision authority, navigation, damage or movement authority. The
 * bridge supplies a canonical bodyId/creatureId and the actor only interpolates the supplied
 * transform and selects an animation. Missing drink/rest clips intentionally use documented
 * idle fallbacks until an owned adapter exists.
 */
UCLASS()
class TORNVEILONLINE_API ATVWildlifePresentation : public AActor {
    GENERATED_BODY()
public:
    ATVWildlifePresentation();
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;

    /** Apply one renderer-neutral canonical wildlife row from the bridge. */
    bool Project(const TSharedPtr<class FJsonObject>& Data, const FVector& CanonicalOrigin, float UnitsPerMetre, bool bFirst);
    void RebasePresentation(const FVector& Delta);
    void SetCanonicalTransform(const FVector& PositionCm, float YawDegrees, const FVector& VelocityCmPerSecond);

    UPROPERTY(BlueprintReadOnly, Category="Torn Veil|Wildlife") FString BodyId;
    UPROPERTY(BlueprintReadOnly, Category="Torn Veil|Wildlife") FString CreatureId;
    UPROPERTY(BlueprintReadOnly, Category="Torn Veil|Wildlife") FString SpeciesId;
    UPROPERTY(BlueprintReadOnly, Category="Torn Veil|Wildlife") FString RegionId;
    UPROPERTY(BlueprintReadOnly, Category="Torn Veil|Wildlife") FString Activity;
    UPROPERTY(BlueprintReadOnly, Category="Torn Veil|Wildlife") float Condition = 1.f;
    UPROPERTY(BlueprintReadOnly, Category="Torn Veil|Wildlife") bool bAlive = true;
    UPROPERTY(BlueprintReadOnly, Category="Torn Veil|Wildlife") bool bDead = false;
    UPROPERTY(BlueprintReadOnly, Category="Torn Veil|Wildlife") bool bPresent = true;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Torn Veil|Wildlife") TObjectPtr<USkeletalMeshComponent> Mesh;

    UFUNCTION(BlueprintPure, Category="Torn Veil|Wildlife") FString PresentationDiagnostics() const;

private:
    FVector TargetPosition = FVector::ZeroVector;
    FVector TargetVelocity = FVector::ZeroVector;
    float TargetYaw = 0.f;
    float VisualScale = 1.f;
    float ClipTime=0,BlendAge=1,ReferenceScale=1,BodyHeightCm=150;
    bool bSettleCorpse=false;
    float SnapshotAge = 999.f;
    double TickTotalMs=0,TickMaxMs=0;
    int64 TickSamples=0;
    FString LastAnimationKey;
    UPROPERTY() TMap<FString, TObjectPtr<UAnimationAsset>> Clips;
    UPROPERTY() TObjectPtr<UAnimationAsset> CurrentClip;

    // Project-built stylized body for species with no installed animal asset (boar, hare): engine
    // primitives on pivots, animated procedurally from canonical activity and visible defense.
    FString Defense; bool bDefenseAtViewer=false; float BodyRadiusCm=38.f;
    bool bPrimitive=false; float GaitPhase=0.f, DefenseAge=0.f, StompPhase=0.f;
    UPROPERTY() TObjectPtr<class USceneComponent> PrimitiveRoot;
    UPROPERTY() TObjectPtr<class USceneComponent> HeadPivot;
    UPROPERTY() TArray<TObjectPtr<class USceneComponent>> Hips;
    UPROPERTY() TArray<TObjectPtr<class UStaticMeshComponent>> PrimitiveParts;
    void BuildPrimitive();
    void AnimatePrimitive(float DeltaSeconds);
    class UStaticMeshComponent* AddPart(class USceneComponent* Parent, const TCHAR* Shape, const FVector& Location, const FVector& ScaleCm, const FRotator& Rotation, const FLinearColor& Colour);

    void EnsureAssets();
    void SelectAnimation(bool bForce = false);
    UAnimationAsset* ClipForActivity(const FString& CanonicalActivity) const;
};
