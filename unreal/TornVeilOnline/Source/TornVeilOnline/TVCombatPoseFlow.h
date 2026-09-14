#pragma once
#include "CoreMinimal.h"

/** A pose-space residual, not root motion. Starts with the outgoing value/velocity,
 * reaches the incoming authored motion with zero residual velocity before contact. */
namespace TVCombatPoseFlow {
inline FVector Residual(const FVector& Offset,const FVector& Velocity,float Age,float Duration) {
    if(Duration<=0||Age>=Duration)return FVector::ZeroVector;
    const float T=FMath::Clamp(Age/Duration,0.f,1.f);
    // Factored form avoids cancellation near T=1 (visible as a tiny end snap).
    return (Offset*(1+2*T)+Velocity*Duration*T)*FMath::Square(1-T);
}
inline FVector RotationDelta(FQuat A,const FQuat& B) {
    FQuat D=A*B.Inverse();D.Normalize();if(D.W<0)D=D*-1;
    return D.ToRotationVector();
}
}
