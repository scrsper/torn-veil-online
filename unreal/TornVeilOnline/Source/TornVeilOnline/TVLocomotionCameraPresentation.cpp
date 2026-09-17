#include "TVLocomotionCameraPresentation.h"

namespace {
float SignedAngleDelta(float From, float To) {
    return FMath::UnwindDegrees(To - From);
}

ETVPresentationGait GaitForSpeed(float Speed, bool bCrouched) {
    if (Speed <= FTVLocomotionCameraPresentation::MovingThresholdCmPerSecond) return ETVPresentationGait::Stand;
    if (bCrouched) return ETVPresentationGait::Walk;
    if (Speed >= FTVLocomotionCameraPresentation::SprintThresholdCmPerSecond) return ETVPresentationGait::Sprint;
    if (Speed >= FTVLocomotionCameraPresentation::JogThresholdCmPerSecond) return ETVPresentationGait::Jog;
    return ETVPresentationGait::Walk;
}
}

FTVLocomotionCameraSignal FTVLocomotionCameraPresentation::Derive(const FTVLocomotionCameraSample& Sample) {
    FTVLocomotionCameraSignal Out;
    const float Speed = Sample.Velocity.Size2D();
    const float PreviousSpeed = Sample.PreviousVelocity.Size2D();
    const float Dt = FMath::Max(Sample.DeltaSeconds, KINDA_SMALL_NUMBER);
    const float YawDelta = SignedAngleDelta(Sample.PreviousBodyYawDegrees, Sample.BodyYawDegrees);
    Out.SpeedCentimetersPerSecond = Speed;
    Out.AccelerationCentimetersPerSecondSquared = (Speed - PreviousSpeed) / Dt;
    Out.SignedYawDeltaDegrees = YawDelta;
    Out.Gait = GaitForSpeed(Speed, Sample.bCrouched);
    Out.bMoving = Speed > MovingThresholdCmPerSecond;
    Out.CameraMode = (Sample.bDead || Sample.bDowned)
        ? ETVPresentationCameraMode::Incapacitated
        : (Sample.CombatPhase == ETVPresentationCombatPhase::None
            ? ETVPresentationCameraMode::Exploration : ETVPresentationCameraMode::Combat);

    const bool bWasMoving = PreviousSpeed > MovingThresholdCmPerSecond;
    if (!bWasMoving && Out.bMoving) Out.Transition = ETVPresentationTransition::Start;
    else if (bWasMoving && !Out.bMoving) Out.Transition = ETVPresentationTransition::Stop;
    else if (Out.bMoving && FMath::Abs(YawDelta) >= PivotYawThresholdDegrees)
        Out.Transition = ETVPresentationTransition::Pivot;

    // The side is a camera hint only. Body/capsule translation remains canonical.
    Out.CameraShoulderSign = YawDelta < 0.f ? -1.f : 1.f;
    Out.bRootMotionAllowed = false;
    Out.bActorTranslationAuthority = false;
    return Out;
}
