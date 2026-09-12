#pragma once
#include "CoreMinimal.h"
#include "Animation/AnimInstance.h"
#include "TVCombatAnimInstance.generated.h"

/** Two explicitly sampled poses. No root extraction, animation notifies, or gameplay callbacks. */
UCLASS(Transient)
class TORNVEILONLINE_API UTVCombatAnimInstance : public UAnimInstance {
    GENERATED_BODY()
public:
    UTVCombatAnimInstance();
    UPROPERTY() TObjectPtr<class UAnimSequence> Base;
    UPROPERTY() TObjectPtr<class UAnimSequence> Motion;
    float Time = 0, BaseTime = 0, Weight = 0;
    FVector LeftFoot = FVector::ZeroVector, RightFoot = FVector::ZeroVector;
    float FootLock = 0;
    FVector HandGoal=FVector::ZeroVector;
    float HandWeight=0,Duck=0;
    bool bLowStrike=false;
protected:
    virtual FAnimInstanceProxy* CreateAnimInstanceProxy() override;
    virtual void DestroyAnimInstanceProxy(FAnimInstanceProxy* Proxy) override;
};
