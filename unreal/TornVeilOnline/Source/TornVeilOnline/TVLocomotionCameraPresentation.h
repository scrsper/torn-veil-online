#pragma once

#include "CoreMinimal.h"

/** Presentation-only locomotion state. It never authorizes movement or writes an actor transform. */
enum class ETVPresentationGait : uint8 { Stand, Walk, Jog, Sprint };
enum class ETVPresentationTransition : uint8 { None, Start, Stop, Pivot };
enum class ETVPresentationCameraMode : uint8 { Exploration, Combat, Incapacitated };
enum class ETVPresentationCombatPhase : uint8 { None, Preparation, Active, Recovery, Defense };

struct FTVLocomotionCameraSample {
    FVector Velocity = FVector::ZeroVector;
    FVector PreviousVelocity = FVector::ZeroVector;
    float BodyYawDegrees = 0.f;
    float PreviousBodyYawDegrees = 0.f;
    float DeltaSeconds = 1.f / 60.f;
    bool bGrounded = true;
    bool bCrouched = false;
    bool bDead = false;
    bool bDowned = false;
    ETVPresentationCombatPhase CombatPhase = ETVPresentationCombatPhase::None;
};

struct FTVLocomotionCameraSignal {
    ETVPresentationGait Gait = ETVPresentationGait::Stand;
    ETVPresentationTransition Transition = ETVPresentationTransition::None;
    ETVPresentationCameraMode CameraMode = ETVPresentationCameraMode::Exploration;
    float SpeedCentimetersPerSecond = 0.f;
    float AccelerationCentimetersPerSecondSquared = 0.f;
    float SignedYawDeltaDegrees = 0.f;
    float CameraShoulderSign = 1.f;
    bool bMoving = false;
    bool bRootMotionAllowed = false;
    bool bActorTranslationAuthority = false;
};

/**
 * Converts already-authoritative canonical motion into animation/camera hints.
 * This class deliberately has no UObject/actor dependency: a signal cannot move the body.
 */
class FTVLocomotionCameraPresentation {
public:
    static FTVLocomotionCameraSignal Derive(const FTVLocomotionCameraSample& Sample);

    static constexpr float MovingThresholdCmPerSecond = 5.f;
    static constexpr float JogThresholdCmPerSecond = 250.f;
    static constexpr float SprintThresholdCmPerSecond = 500.f;
    static constexpr float PivotYawThresholdDegrees = 35.f;
};
