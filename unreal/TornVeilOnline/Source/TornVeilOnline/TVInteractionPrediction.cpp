#include "TVInteractionPrediction.h"
#include "TVInteractionSpec.generated.h"

FTVMovementState FTVInteractionPrediction::Step(const FTVMovementState& State,const FTVMovementInput& Input,double Dt,TFunctionRef<TOptional<FTVPredictionColumn>(int32,int32)> Column) {
    using namespace TVInteractionSpec;
    FTVMovementState Next=State;
    if(!State.bEligible||!FMath::IsFinite(Input.X)||!FMath::IsFinite(Input.Z)||!FMath::IsFinite(Dt)||!FMath::IsFinite(State.Speed)||Dt<=0||Dt>.1) return Next;
    const double Length=FMath::Max(1.,FMath::Sqrt(Input.X*Input.X+Input.Z*Input.Z));
    const double Speed=FMath::Max(0.,State.Speed)*(Input.bSprint?sprintMultiplier:1.);
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
        for(const auto& C:Footprint) for(int32 Y:C.Solids) if(Y>=FMath::FloorToInt(Clearance+.05)&&Y<=FMath::FloorToInt(Clearance+height)) return false;
        return true;
    };
    for(int32 I=0;I<Count;I++) {
        if(Fits(Next.Position.X+DX/Count,Next.Position.Z)) Next.Position.X+=DX/Count;
        if(Fits(Next.Position.X,Next.Position.Z+DZ/Count)) Next.Position.Z+=DZ/Count;
        const auto Floor=Column(FMath::FloorToInt(Next.Position.X),FMath::FloorToInt(Next.Position.Z));
        if(Floor.IsSet()&&Floor->Floor>=0)Next.Position.Y=Floor->Floor;
    }
    if(FMath::Sqrt(FMath::Square(Next.Position.X-State.Position.X)+FMath::Square(Next.Position.Z-State.Position.Z))>1e-9)
        Next.Yaw=FMath::Atan2(-(Next.Position.X-State.Position.X),-(Next.Position.Z-State.Position.Z));
    return Next;
}
