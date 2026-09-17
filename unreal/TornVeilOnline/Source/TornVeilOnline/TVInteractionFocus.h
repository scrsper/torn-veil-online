#pragma once
#include "CoreMinimal.h"
// Selection geometry is query-only. A server-projected affordance is still revalidated on use.
namespace TVInteractionFocus {
inline double Score(const FBox2D& Bounds,const FVector2D& Aim,double ViewportHeight) {
    if(!Bounds.bIsValid||ViewportHeight<=0)return TNumericLimits<double>::Max();
    const FVector2D Closest(FMath::Clamp(Aim.X,Bounds.Min.X,Bounds.Max.X),FMath::Clamp(Aim.Y,Bounds.Min.Y,Bounds.Max.Y));
    const double Miss=FVector2D::Distance(Aim,Closest)/ViewportHeight;
    if(Miss>.28)return TNumericLimits<double>::Max();
    return Miss+FVector2D::Distance(Aim,Bounds.GetCenter())/ViewportHeight*.025;
}
}
