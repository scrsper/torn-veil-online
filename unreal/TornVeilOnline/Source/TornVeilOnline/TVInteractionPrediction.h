#pragma once
#include "CoreMinimal.h"

// Disposable prediction in canonical metres: X=x, Y=up, Z=z. No actor/world mutation.
struct FTVMovementState { FVector Position=FVector::ZeroVector; double Yaw=0,Speed=0; bool bEligible=false; double Crouch=0; };
struct FTVMovementInput { double X=0,Z=0; bool bSprint=false; TOptional<double> Facing; bool bCrouch=false; };
struct FTVPredictionColumn { double Floor=-1; bool bWalkable=false; TArray<int32> Solids; };
class FTVInteractionPrediction {
public:
    static FTVMovementState Posture(const FTVMovementState& State,bool Held,double Dt,TFunctionRef<TOptional<FTVPredictionColumn>(int32,int32)> Column);
    static bool PostureFits(const FTVMovementState& State,double Amount,TFunctionRef<TOptional<FTVPredictionColumn>(int32,int32)> Column);
    static FTVMovementState Step(const FTVMovementState& State,const FTVMovementInput& Input,double Dt,TFunctionRef<TOptional<FTVPredictionColumn>(int32,int32)> Column);
};
