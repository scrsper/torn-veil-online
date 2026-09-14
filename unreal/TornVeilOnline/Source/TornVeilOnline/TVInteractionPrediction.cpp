#include "TVInteractionPrediction.h"
#include "TVInteractionSpec.generated.h"

FTVMovementState FTVInteractionPrediction::Step(const FTVMovementState& State,const FTVMovementInput& Input,double Dt,TFunctionRef<TOptional<FTVPredictionColumn>(int32,int32)> Column) {
    using namespace TVInteractionSpec;
    FTVMovementState Next=State;
    if(!State.bEligible||!FMath::IsFinite(Input.X)||!FMath::IsFinite(Input.Z)||!FMath::IsFinite(Dt)||!FMath::IsFinite(State.Speed)||Dt<=0||Dt>.1) return Next;
    const double Length=FMath::Max(1.,FMath::Sqrt(Input.X*Input.X+Input.Z*Input.Z));
    const bool ForwardSprint=!Input.Facing.IsSet()||(-Input.X*FMath::Sin(Input.Facing.GetValue())-Input.Z*FMath::Cos(Input.Facing.GetValue()))/FMath::Max(.001,FMath::Sqrt(Input.X*Input.X+Input.Z*Input.Z))>.7;
    const double Speed=FMath::Max(0.,State.Speed)*(State.Crouch>.01?crouchSpeedMultiplier:Input.bSprint&&ForwardSprint?sprintMultiplier:1.);
    const double DX=Input.X/Length*Speed*Dt,DZ=Input.Z/Length*Speed*Dt;
    const int32 Count=FMath::Max(1,FMath::CeilToInt(FMath::Max(FMath::Abs(DX),FMath::Abs(DZ))/sweepStep));
    auto Fits=[&](double PX,double PZ) {
        const auto Center=Column(FMath::FloorToInt(PX),FMath::FloorToInt(PZ));
        if(!Center.IsSet()||!Center->bWalkable||Center->Floor<0||FMath::Abs(Center->Floor-Next.Position.Y)>stepHeight) return false;
        double Clearance=Center->Floor;
        TArray<FTVPredictionColumn,TInlineAllocator<4>> Footprint;
        for(int32 X=FMath::FloorToInt(PX-radius);X<=FMath::FloorToInt(PX+radius);X++) for(int32 Z=FMath::FloorToInt(PZ-radius);Z<=FMath::FloorToInt(PZ+radius);Z++) {
            const auto Edge=Column(X,Z);
            if(!Edge.IsSet()||Edge->Floor<0||FMath::Abs(Edge->Floor-Center->Floor)>stepHeight) return false;
            Clearance=FMath::Max(Clearance,Edge->Floor);Footprint.Add(*Edge);
        }
        for(const auto& C:Footprint) for(int32 Y:C.Solids) if(Y>=FMath::FloorToInt(Clearance+.05)&&Y<=FMath::FloorToInt(Clearance+height+(duckHeight-height)*State.Crouch)) return false;
        return true;
    };
    for(int32 I=0;I<Count;I++) {
        if(Fits(Next.Position.X+DX/Count,Next.Position.Z)) Next.Position.X+=DX/Count;
        if(Fits(Next.Position.X,Next.Position.Z+DZ/Count)) Next.Position.Z+=DZ/Count;
        const auto Floor=Column(FMath::FloorToInt(Next.Position.X),FMath::FloorToInt(Next.Position.Z));
        if(Floor.IsSet()&&Floor->Floor>=0)Next.Position.Y=Floor->Floor;
    }
    if(Input.Facing.IsSet()&&FMath::IsFinite(Input.Facing.GetValue())&&FMath::Abs(Input.Facing.GetValue())<=PI){
        const double D=FMath::Atan2(FMath::Sin(Input.Facing.GetValue()-State.Yaw),FMath::Cos(Input.Facing.GetValue()-State.Yaw));
        const double Y=State.Yaw+FMath::Clamp(D,-facingRadiansPerSecond*Dt,facingRadiansPerSecond*Dt);Next.Yaw=FMath::Atan2(FMath::Sin(Y),FMath::Cos(Y));
    }else if(FMath::Sqrt(FMath::Square(Next.Position.X-State.Position.X)+FMath::Square(Next.Position.Z-State.Position.Z))>1e-9)
        Next.Yaw=FMath::Atan2(-(Next.Position.X-State.Position.X),-(Next.Position.Z-State.Position.Z));
    return Next;
}

bool FTVInteractionPrediction::PostureFits(const FTVMovementState& State,double Amount,TFunctionRef<TOptional<FTVPredictionColumn>(int32,int32)> Column){
 using namespace TVInteractionSpec;
 for(int32 X=FMath::FloorToInt(State.Position.X-radius);X<=FMath::FloorToInt(State.Position.X+radius);++X)for(int32 Z=FMath::FloorToInt(State.Position.Z-radius);Z<=FMath::FloorToInt(State.Position.Z+radius);++Z){
  const auto C=Column(X,Z);if(!C.IsSet())return false;
  for(int Y:C->Solids)if(Y+1>State.Position.Y+.05&&Y<State.Position.Y+height+(duckHeight-height)*Amount)return false;
 }return true;
}
FTVMovementState FTVInteractionPrediction::Posture(const FTVMovementState& State,bool Held,double Dt,TFunctionRef<TOptional<FTVPredictionColumn>(int32,int32)> Column){
 auto Next=State;const double Amount=Held&&State.bEligible?FMath::Min(1.,State.Crouch+Dt/TVInteractionSpec::crouchEnterSeconds):FMath::Max(0.,State.Crouch-Dt/TVInteractionSpec::crouchExitSeconds);
 if(Amount>=State.Crouch||!State.bEligible||PostureFits(State,Amount,Column))Next.Crouch=Amount;return Next;
}
