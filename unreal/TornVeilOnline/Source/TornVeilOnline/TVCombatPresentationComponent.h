#pragma once
#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "TVCombatChoreography.h"
#include "TVLiveCombat.h"
#include "TVCombatPresentationComponent.generated.h"

struct FTVScheduledCombat { FTVChoreographyRequest Request; FTVChoreographyPlan Plan; double StartsAt=0; };
UCLASS()
class TORNVEILONLINE_API UTVCombatPresentationComponent : public UActorComponent {
    GENERATED_BODY()
public:
    UTVCombatPresentationComponent();
    virtual void BeginPlay() override;
    void ObserveAction(const FTVLiveCombat& Action,double Age);
    void RejectAction(const FString& CommandId);
    void ContactReaction();
    FString LiveActionId() const {return Live.Id;}
    double LiveActionAge() const {return Age;}
    void Enqueue(const FTVChoreographyRequest& Request, const FTVChoreographyPlan& Plan, double Start);
    bool Present(float Dt);
    void Cancel();
    void WriteDiagnostics(const TSharedPtr<class FJsonObject>& Json) const;
    int32 LOD() const;
    double AvailableAt=0;
    int64 PlayedAttacks=0, PlayedHits=0, Dropped=0;
    int32 PendingAttacks() const;
    int32 PendingHits() const;
    FString AnimationPath() const;
private:
    UPROPERTY() TObjectPtr<class UAnimSequence> Idle;
    UPROPERTY() TMap<FString,TObjectPtr<class UAnimSequence>> Animations;
    UPROPERTY() TObjectPtr<class UProceduralMeshComponent> Ribbon;
    UPROPERTY() TObjectPtr<class UStaticMeshComponent> Flash;
    UPROPERTY() TObjectPtr<class UMaterialInstanceDynamic> EffectMaterial;
    TArray<FTVScheduledCombat> Queue;
    FTVScheduledCombat Current;
    bool bActive=false,bContact=false;
    bool bLive=false,bOwningTimeline=false;
    FTVLiveCombat Live;
    double LiveAge=0,LiveContactReceivedAt=-1;
    float Age=0, Hold=0, MaxOffset=0, MeasuredContactError=0;
    FVector BaseLocation=FVector::ZeroVector;
    FVector LeftAnchor=FVector::ZeroVector, RightAnchor=FVector::ZeroVector;
    FRotator BaseRotation=FRotator::ZeroRotator;
    TArray<FVector> Trail;
    TArray<int64> PlayedSequences;
    void Effects(float Dt);
};
