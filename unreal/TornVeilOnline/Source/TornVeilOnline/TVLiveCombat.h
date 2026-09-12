#pragma once
#include "CoreMinimal.h"
#include "TVInteractionPrediction.h"
#include "TVCombatChoreography.h"

/** Disposable physical timeline. Canonical seconds on wire; Age is client presentation time. */
struct TORNVEILONLINE_API FTVLiveCombat {
    FString TechniqueId, TechniqueName, TransitionTechniqueId, Motion;
    FString Id, CommandId, ActorBodyId, Kind, Phase, Outcome, Trajectory=TEXT("high"), Variant=TEXT("direct");
    double StartedAt=0, ActiveAt=.3, RecoveryAt=.45, CompleteAt=.75, Facing=0, Reach=.9, Radius=.12;
    FVector Direction=FVector::ZeroVector;
    double Distance=0, ContactAt=-1;
    FVector ContactPosition=FVector::ZeroVector;
    float Strength=.5f,Dexterity=.5f,Exertion=1;
    bool bPredicted=false;
    bool IsValid() const {return !Kind.IsEmpty();}
    bool Locked(double Age) const {return IsValid()&&Age<CompleteAt-StartedAt;}
    bool Running(double Age) const {return IsValid()&&Age<CompleteAt-StartedAt&&Outcome!=TEXT("interrupted")&&Outcome!=TEXT("cancelled");}
    bool IsAttack() const {return Kind==TEXT("attack");}
    double TransitionAge(const FString& NextKind) const;
    static bool Parse(const TSharedPtr<FJsonObject>& Json,FTVLiveCombat& Out);
    bool ApplyMartialChoice(const TSharedPtr<FJsonObject>& Choices,const FString& Previous,const FString& Semantic);
    static FTVLiveCombat Predict(const FString& Kind,double Facing,int32 Side,const FString& CommandId);
    FTVMovementState Step(const FTVMovementState& State,double Age,double Dt,TFunctionRef<TOptional<FTVPredictionColumn>(int32,int32)> Column) const;
    FVector StrikePoint(double Age) const;
    float Duck(double Age) const;
    FTVChoreographyPlan Plan(int32 LOD) const;
};
