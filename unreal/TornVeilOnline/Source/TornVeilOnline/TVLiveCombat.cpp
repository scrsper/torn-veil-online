#include "TVLiveCombat.h"
#include "TVInteractionSpec.generated.h"
#include "TVCombatMotion.generated.h"
#include "Dom/JsonObject.h"
bool FTVLiveCombat::Parse(const TSharedPtr<FJsonObject>& J,FTVLiveCombat& O) {
    if(!J||!J->TryGetStringField(TEXT("id"),O.Id)||!J->TryGetStringField(TEXT("kind"),O.Kind))return false;
    J->TryGetStringField(TEXT("commandId"),O.CommandId);J->TryGetStringField(TEXT("actorBodyId"),O.ActorBodyId);
    J->TryGetStringField(TEXT("phase"),O.Phase);J->TryGetStringField(TEXT("outcome"),O.Outcome);J->TryGetStringField(TEXT("trajectory"),O.Trajectory);
    J->TryGetStringField(TEXT("variant"),O.Variant);
    if(!J->TryGetNumberField(TEXT("startedAt"),O.StartedAt)||!J->TryGetNumberField(TEXT("activeAt"),O.ActiveAt)||!J->TryGetNumberField(TEXT("recoveryAt"),O.RecoveryAt)||!J->TryGetNumberField(TEXT("completeAt"),O.CompleteAt))return false;
    J->TryGetNumberField(TEXT("facing"),O.Facing);J->TryGetNumberField(TEXT("reach"),O.Reach);J->TryGetNumberField(TEXT("radius"),O.Radius);J->TryGetNumberField(TEXT("distance"),O.Distance);
    const TSharedPtr<FJsonObject>* D;
    if(J->TryGetObjectField(TEXT("direction"),D))O.Direction=FVector((*D)->GetNumberField(TEXT("x")),(*D)->GetNumberField(TEXT("y")),(*D)->GetNumberField(TEXT("z")));
    if(J->TryGetObjectField(TEXT("capability"),D)){O.Strength=(*D)->GetNumberField(TEXT("strength"));O.Dexterity=(*D)->GetNumberField(TEXT("dexterity"));O.Exertion=(*D)->GetNumberField(TEXT("exertion"));}
    if(J->TryGetObjectField(TEXT("contact"),D)){O.ContactAt=(*D)->GetNumberField(TEXT("at"));const auto P=(*D)->GetObjectField(TEXT("position"));O.ContactPosition=FVector(P->GetNumberField(TEXT("x")),P->GetNumberField(TEXT("y")),P->GetNumberField(TEXT("z")));}
    return FMath::IsFinite(O.StartedAt)&&FMath::IsFinite(O.CompleteAt)&&O.CompleteAt>=O.StartedAt&&O.CompleteAt-O.StartedAt<3;
}
FTVLiveCombat FTVLiveCombat::Predict(const FString& Kind,double Facing,int32 Side,const FString& CommandId) {
    using namespace TVInteractionSpec;FTVLiveCombat A;A.Kind=Kind;A.CommandId=CommandId;A.Id=CommandId;A.Facing=Facing;A.bPredicted=true;A.Phase=TEXT("preparation");A.Outcome=TEXT("pending");
    A.ActiveAt=Kind==TEXT("attack")?preparationSeconds:0;A.RecoveryAt=Kind==TEXT("attack")?preparationSeconds+activeSeconds:defenseSeconds;
    A.CompleteAt=A.RecoveryAt+(Kind==TEXT("attack")?recoverySeconds:defenseRecoverySeconds);A.Reach=unarmedPathReach;
    if(Kind==TEXT("duck")){A.RecoveryAt=duckRecoveryAt;A.CompleteAt=duckSeconds;}
    A.Distance=Kind==TEXT("sidestep")?sidestepMetres:Kind==TEXT("backstep")?backstepMetres:0;
    A.Direction=Kind==TEXT("sidestep")?FVector(FMath::Cos(Facing)*Side,0,-FMath::Sin(Facing)*Side):Kind==TEXT("backstep")?FVector(FMath::Sin(Facing),0,FMath::Cos(Facing)):FVector::ZeroVector;
    return A;
}
FTVMovementState FTVLiveCombat::Step(const FTVMovementState& State,double Age,double Dt,TFunctionRef<TOptional<FTVPredictionColumn>(int32,int32)> Column) const {
    if(!Running(Age)||IsAttack())return State;
    const double Span=FMath::Max(0.,FMath::Min(Age+Dt,RecoveryAt-StartedAt)-FMath::Max(0.,Age));if(Span<=0)return State;
    const auto Progress=[](double T){const double X=FMath::Clamp(T,0.,1.);return X*X*(3-2*X);};
    FTVMovementState Input=State;Input.Speed=Distance*(Progress((Age+Span)/TVInteractionSpec::defenseSeconds)-Progress(Age/TVInteractionSpec::defenseSeconds))/Span;
    auto Next=FTVInteractionPrediction::Step(Input,{Direction.X,Direction.Z,false},Span,Column);Next.Yaw=Facing;Next.Speed=State.Speed;return Next;
}
double FTVLiveCombat::TransitionAge(const FString& NextKind) const {
    if(!IsValid())return 0;
    if(Outcome==TEXT("interrupted")||Outcome==TEXT("cancelled")||Kind==TEXT("duck"))return CompleteAt-StartedAt;
    if(IsAttack())return FMath::Min(CompleteAt-StartedAt,RecoveryAt-StartedAt+(NextKind==TEXT("attack")?TVInteractionSpec::attackChainSeconds:TVInteractionSpec::attackEvadeSeconds));
    return RecoveryAt-StartedAt;
}
FVector FTVLiveCombat::StrikePoint(double Age) const {
    const FVector Local=TVCombatMotion::Strike(Variant,Age-(ActiveAt-StartedAt));
    return FVector(-FMath::Sin(Facing)*Local.Z+FMath::Cos(Facing)*Local.X,Local.Y,-FMath::Cos(Facing)*Local.Z-FMath::Sin(Facing)*Local.X);
}
float FTVLiveCombat::Duck(double Age) const {return Kind==TEXT("duck")&&Running(Age)?TVCombatMotion::Duck(Age):0;}
FTVChoreographyPlan FTVLiveCombat::Plan(int32 LOD) const {
    FTVChoreographyRequest R;R.LOD=LOD;R.Event.WeaponType=TEXT("unarmed");R.Event.ActorBodyId=ActorBodyId;R.Event.Strength=Strength;R.Event.Dexterity=Dexterity;R.Event.Exertion=Exertion;R.Event.Outcome=TEXT("miss");
    auto P=FTVCombatChoreographer::Plan(R);P.Anticipation=ActiveAt-StartedAt;P.Strike=RecoveryAt-ActiveAt;P.Recovery=CompleteAt-RecoveryAt;P.Duration=CompleteAt-StartedAt;P.ContactAt=RecoveryAt-StartedAt;
    P.bTimeline=true;
    FString Clip=Variant==TEXT("kick")?TEXT("Kick"):Variant==TEXT("hook")?TEXT("Cross"):TEXT("Jab");
    P.Motion.Effector=Variant==TEXT("kick")?TEXT("foot_r"):Variant==TEXT("hook")?TEXT("middle_01_r"):TEXT("middle_01_l");
    if(Kind==TEXT("duck"))Clip=TEXT("Duck");
    else if(!IsAttack()) {
        const double Right=Direction.X*FMath::Cos(Facing)-Direction.Z*FMath::Sin(Facing);
        const double Forward=-Direction.X*FMath::Sin(Facing)-Direction.Z*FMath::Cos(Facing);
        Clip=FMath::Abs(Forward)>FMath::Abs(Right)?(Forward>0?TEXT("StepForward"):TEXT("StepBack")):(Right>0?TEXT("StepRight"):TEXT("StepLeft"));
    }
    P.Motion.Id=Clip;P.Motion.AssetPath=TEXT("/Game/TornVeil/Combat/Repair/Animations/A_TV_")+Clip;
    P.Motion.Length=P.Duration;P.Motion.ContactTime=P.ContactAt;
    P.AlignmentYaw=0;P.PivotYaw=0;P.LeanDegrees=0;P.ContactOffset=FVector::ZeroVector;P.FX.HitStop=0;P.FX.Impact=0;P.FX.Camera=0;return P;
}
