#include "TVLocomotionCameraPresentation.h"

#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"

namespace {
FTVLocomotionCameraSample Sample(float Speed, float PreviousSpeed, float Yaw = 0.f, float PreviousYaw = 0.f) {
    FTVLocomotionCameraSample S;
    S.Velocity = FVector(Speed, 0.f, 0.f);
    S.PreviousVelocity = FVector(PreviousSpeed, 0.f, 0.f);
    S.BodyYawDegrees = Yaw;
    S.PreviousBodyYawDegrees = PreviousYaw;
    return S;
}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVLocomotionPresentationSignals,
    "TornVeil.Presentation.LocomotionSignals", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVLocomotionPresentationSignals::RunTest(const FString&) {
    const auto Start = FTVLocomotionCameraPresentation::Derive(Sample(120.f, 0.f));
    TestTrue(TEXT("movement start is presentation signal"), Start.Transition == ETVPresentationTransition::Start);
    TestTrue(TEXT("slow movement selects walk"), Start.Gait == ETVPresentationGait::Walk);
    TestTrue(TEXT("start acceleration is derived"), Start.AccelerationCentimetersPerSecondSquared > 7000.f);

    const auto Jog = FTVLocomotionCameraPresentation::Derive(Sample(300.f, 300.f));
    TestTrue(TEXT("medium speed selects jog"), Jog.Gait == ETVPresentationGait::Jog);
    TestTrue(TEXT("steady motion has no transition"), Jog.Transition == ETVPresentationTransition::None);

    const auto Sprint = FTVLocomotionCameraPresentation::Derive(Sample(600.f, 300.f));
    TestTrue(TEXT("high speed selects sprint"), Sprint.Gait == ETVPresentationGait::Sprint);
    TestTrue(TEXT("sprint acceleration remains presentation data"), Sprint.AccelerationCentimetersPerSecondSquared > 0.f);

    const auto Stop = FTVLocomotionCameraPresentation::Derive(Sample(0.f, 120.f));
    TestTrue(TEXT("movement stop is presentation signal"), Stop.Transition == ETVPresentationTransition::Stop);
    TestTrue(TEXT("stop returns to stand"), Stop.Gait == ETVPresentationGait::Stand);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVLocomotionPresentationPivotAndAuthority,
    "TornVeil.Presentation.PivotAndAuthority", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVLocomotionPresentationPivotAndAuthority::RunTest(const FString&) {
    auto PivotSample = Sample(180.f, 180.f, 355.f, 0.f);
    const auto Pivot = FTVLocomotionCameraPresentation::Derive(PivotSample);
    TestTrue(TEXT("yaw wraps to shortest signed delta"), FMath::IsNearlyEqual(Pivot.SignedYawDeltaDegrees, -5.f));
    TestTrue(TEXT("small wrapped turn is not a pivot"), Pivot.Transition == ETVPresentationTransition::None);

    PivotSample.BodyYawDegrees = 50.f;
    const auto LargePivot = FTVLocomotionCameraPresentation::Derive(PivotSample);
    TestTrue(TEXT("large turn while moving selects pivot"), LargePivot.Transition == ETVPresentationTransition::Pivot);
    TestTrue(TEXT("positive turn keeps right shoulder hint"), LargePivot.CameraShoulderSign > 0.f);

    PivotSample.bCrouched = true;
    const auto Crouched = FTVLocomotionCameraPresentation::Derive(PivotSample);
    TestTrue(TEXT("crouch clamps gait presentation to walk"), Crouched.Gait == ETVPresentationGait::Walk);
    TestFalse(TEXT("presentation never grants root motion authority"), Crouched.bRootMotionAllowed);
    TestFalse(TEXT("presentation never owns actor translation"), Crouched.bActorTranslationAuthority);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVLocomotionCameraModes,
    "TornVeil.Presentation.CameraModes", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVLocomotionCameraModes::RunTest(const FString&) {
    auto Exploration = Sample(0.f, 0.f);
    TestTrue(TEXT("no combat uses exploration camera"), FTVLocomotionCameraPresentation::Derive(Exploration).CameraMode == ETVPresentationCameraMode::Exploration);
    Exploration.CombatPhase = ETVPresentationCombatPhase::Preparation;
    TestTrue(TEXT("combat phase selects combat camera"), FTVLocomotionCameraPresentation::Derive(Exploration).CameraMode == ETVPresentationCameraMode::Combat);
    Exploration.bDowned = true;
    TestTrue(TEXT("downed state selects incapacitated camera"), FTVLocomotionCameraPresentation::Derive(Exploration).CameraMode == ETVPresentationCameraMode::Incapacitated);
    Exploration.bDowned = false; Exploration.bDead = true;
    TestTrue(TEXT("dead state selects incapacitated camera"), FTVLocomotionCameraPresentation::Derive(Exploration).CameraMode == ETVPresentationCameraMode::Incapacitated);
    return true;
}
#endif
