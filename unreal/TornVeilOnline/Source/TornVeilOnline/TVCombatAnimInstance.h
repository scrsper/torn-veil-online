#pragma once
#include "CoreMinimal.h"
#include "Animation/AnimInstance.h"
#include "Animation/PoseSnapshot.h"
#include "TVCombatAnimInstance.generated.h"

/** Two explicitly sampled poses. No root extraction, animation notifies, or gameplay callbacks. */
UCLASS(Transient)
class TORNVEILONLINE_API UTVCombatAnimInstance : public UAnimInstance {
    GENERATED_BODY()
public:
    UTVCombatAnimInstance();
    UPROPERTY() TObjectPtr<class UAnimSequence> Base;
    UPROPERTY() TObjectPtr<class UAnimSequence> Motion;
    UPROPERTY() TObjectPtr<class UBlendSpace> Locomotion;
    FPoseSnapshot Snapshot;
    bool bSnapshot=false,bLocomotion=false;
    // Serial changes only on action handoff, never on an authoritative receipt.
    uint32 FlowSerial=0;
    bool bFlow=false;
    float FlowDuration=.14f;
    float FlowRawAngularDegrees=0,FlowFirstAngularDegrees=0,FlowPelvisJumpCm=0,FlowRootJumpCm=0,FlowFootJumpCm=0;
    virtual void NativePostEvaluateAnimation() override;
    FVector LocomotionPosition=FVector::ZeroVector;
    // Evaluated graph time, not the requested pose time or a single-node fallback.
    float EvaluatedLocomotionTime=0;
    float Time = 0, BaseTime = 0, Weight = 0;
    FVector LeftFoot = FVector::ZeroVector, RightFoot = FVector::ZeroVector;
    float FootLock = 0;
    bool bCarrySupport=false;
    FVector HandGoal=FVector::ZeroVector;
    float HandWeight=0,Duck=0,Guard=0;
    FVector GuardLeftGoal,GuardRightGoal;
    bool bLowStrike=false,bReleaseRightFoot=false;
protected:
    virtual FAnimInstanceProxy* CreateAnimInstanceProxy() override;
    virtual void DestroyAnimInstanceProxy(FAnimInstanceProxy* Proxy) override;
};
