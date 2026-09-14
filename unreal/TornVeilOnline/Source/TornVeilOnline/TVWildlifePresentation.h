#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TVWildlifePresentation.generated.h"

class USceneComponent;
class UStaticMeshComponent;

/** Disposable rendering of one canonical creature manifestation. It never runs AI, collision,
 * damage, navigation, spawning, or inventory logic. Omission removes it; dead is a rendered state. */
UCLASS()
class TORNVEILONLINE_API ATVWildlifePresentation : public AActor {
    GENERATED_BODY()
public:
    ATVWildlifePresentation();
    virtual void Tick(float DeltaSeconds) override;
    bool Project(const TSharedPtr<class FJsonObject>& Data,const FVector& CanonicalOrigin,float UnitsPerMetre,bool bFirst);
    void RebasePresentation(const FVector& Delta);
    FString BodyId,CreatureId,SpeciesId,RegionId,Activity;
    bool bDead=false;
    UFUNCTION(BlueprintPure,Category="Torn Veil|Presentation") FString PresentationDiagnostics() const;
private:
    UPROPERTY() TObjectPtr<USceneComponent> VisualRoot;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Torso;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Neck;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Head;
    UPROPERTY() TArray<TObjectPtr<UStaticMeshComponent>> Legs;
    FVector PreviousPosition=FVector::ZeroVector,TargetPosition=FVector::ZeroVector,CanonicalVelocity=FVector::ZeroVector;
    float TargetYaw=0,SnapshotAge=0,VisualAge=0,VisualScale=1,Condition=1;
    double TickTotalMs=0,TickMaxMs=0;
    int64 TickSamples=0;
    FVector ProjectedPosition(const TSharedPtr<class FJsonObject>& Position,const FVector& Origin,float Units) const;
};
