#include "TVCharacter.h"
#include "TVBridgeSubsystem.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/TextRenderComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Animation/AnimSingleNodeInstance.h"
#include "Animation/AnimationAsset.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Camera/PlayerCameraManager.h"
#include "GameFramework/PlayerController.h"
#include "UObject/ConstructorHelpers.h"

ATVCharacter::ATVCharacter() {
    PrimaryActorTick.bCanEverTick = true;
    GetCapsuleComponent()->InitCapsuleSize(30, 90);
    bUseControllerRotationYaw = false; bUseControllerRotationPitch = false; bUseControllerRotationRoll = false;
    GetCharacterMovement()->bOrientRotationToMovement = true; GetCharacterMovement()->RotationRate = FRotator(0, 540, 0);
    GetCharacterMovement()->MaxWalkSpeed = 460; GetCharacterMovement()->MaxStepHeight = 105;
    GetCharacterMovement()->BrakingDecelerationWalking = 6000; GetCharacterMovement()->MaxAcceleration = 6000;
    GetCharacterMovement()->GroundFriction = 12;
    CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom")); CameraBoom->SetupAttachment(RootComponent);
    CameraBoom->TargetArmLength = 450; CameraBoom->SocketOffset = FVector(0, 45, 70); CameraBoom->bUsePawnControlRotation = true;
    CameraBoom->bEnableCameraLag = true; CameraBoom->CameraLagSpeed = 12;
    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera")); Camera->SetupAttachment(CameraBoom); Camera->FieldOfView = 75;
    Nameplate = CreateDefaultSubobject<UTextRenderComponent>(TEXT("CanonicalName")); Nameplate->SetupAttachment(RootComponent);
    Nameplate->SetRelativeLocation(FVector(0, 0, 125)); Nameplate->SetWorldSize(18); Nameplate->SetHorizontalAlignment(EHTA_Center); Nameplate->SetTextRenderColor(FColor(235, 210, 160));
    static ConstructorHelpers::FObjectFinder<USkeletalMesh> Humanoid(TEXT("/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple"));
    if (Humanoid.Succeeded()) GetMesh()->SetSkeletalMesh(Humanoid.Object);
    GetMesh()->SetRelativeLocation(FVector(0, 0, -90)); GetMesh()->SetRelativeRotation(FRotator(0, -90, 0)); GetMesh()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    static ConstructorHelpers::FObjectFinder<UAnimationAsset> Loc(TEXT("/Game/Characters/Mannequins/Anims/Unarmed/BS_Idle_Walk_Run")); Locomotion = Loc.Object;
    static ConstructorHelpers::FObjectFinder<UAnimationAsset> Atk(TEXT("/Game/Characters/Mannequins/Anims/Unarmed/Attack/MM_Attack_01")); AttackAnimation = Atk.Object;
    static ConstructorHelpers::FObjectFinder<UAnimationAsset> Hit(TEXT("/Game/Characters/Mannequins/Anims/Rifle/HitReact/MM_HitReact_Front_Lgt_01")); HitAnimation = Hit.Object;
    static ConstructorHelpers::FObjectFinder<UAnimationAsset> Down(TEXT("/Game/Characters/Mannequins/Anims/Death/MM_Death_Front_01")); DownAnimation = Down.Object;
}
void ATVCharacter::BeginPlay() {
    Super::BeginPlay();
    if (IsPlayerControlled()) { bCanonicalPlayer = true; Controller->SetControlRotation(FRotator(-18, 0, 0)); Nameplate->SetVisibility(false); }
    else { GetCharacterMovement()->DisableMovement(); GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision); }
}
FVector ATVCharacter::IntentDirection() const {
    if (!Controller || bIncapacitated) return FVector::ZeroVector;
    const FRotationMatrix Basis(FRotator(0, Controller->GetControlRotation().Yaw, 0));
    return (Basis.GetUnitAxis(EAxis::X) * ForwardAxis + Basis.GetUnitAxis(EAxis::Y) * RightAxis).GetClampedToMaxSize(1);
}
void ATVCharacter::Tick(float Dt) {
    Super::Tick(Dt); SnapshotAge += Dt;
    auto* Bridge = GetWorld()->GetSubsystem<UTVBridgeSubsystem>();
    const bool Live = Bridge && Bridge->SinceSnapshot < 0.5f;
    if (bCanonicalPlayer) {
        CameraBoom->TargetArmLength = FMath::FInterpTo(CameraBoom->TargetArmLength, ZoomTarget, Dt, 8);
        CameraBoom->SocketOffset.Y = FMath::GetMappedRangeValueClamped(FVector2D(160, 700), FVector2D(55, 0), ZoomTarget);
        GetCharacterMovement()->MaxWalkSpeed = CanonicalSpeed * (bSprint ? CanonicalSprintMultiplier : 1.f);
        if (Live && !bIncapacitated) AddMovementInput(IntentDirection()); else GetCharacterMovement()->StopMovementImmediately();
        if (bProjected && Live) {
            const FVector Expected = TargetPosition + CanonicalVelocity * FMath::Min(SnapshotAge, 0.1f);
            const FVector Error = Expected - GetActorLocation();
            if (Error.Size() > 250) SetActorLocation(Expected, false, nullptr, ETeleportType::TeleportPhysics);
            else SetActorLocation(GetActorLocation() + Error * FMath::Min(Dt * 6, 1.f), false);
        }
    } else if (bProjected) {
        const float Alpha = FMath::Clamp(SnapshotAge / 0.1f, 0.f, 1.f);
        SetActorLocation(FMath::Lerp(PreviousPosition, TargetPosition, Alpha));
        SetActorRotation(FMath::RInterpTo(GetActorRotation(), FRotator(0, TargetYaw, 0), Dt, 10));
        if (auto* PC = GetWorld()->GetFirstPlayerController()) { const auto R = (PC->PlayerCameraManager->GetCameraLocation() - Nameplate->GetComponentLocation()).Rotation(); Nameplate->SetWorldRotation(R); }
    }
    Animate(bCanonicalPlayer ? GetVelocity().Size2D() : (Live ? CanonicalVelocity.Size2D() : 0));
}
void ATVCharacter::Project(const TSharedPtr<FJsonObject>& D, bool First) {
    BodyId = D->GetStringField(TEXT("bodyId")); EntityId = D->GetStringField(TEXT("entityId")); DisplayName = D->GetStringField(TEXT("name"));
    Activity = D->GetStringField(TEXT("activity")); Occupation = D->GetStringField(TEXT("occupation")); CanonicalPose = D->GetStringField(TEXT("pose"));
    Health = D->GetNumberField(TEXT("health")); MaxHealth = D->GetNumberField(TEXT("maxHealth"));
    bDead = D->GetBoolField(TEXT("dead")); bIncapacitated = D->GetBoolField(TEXT("incapacitated")) || bDead;
    D->TryGetStringField(TEXT("attackTarget"), AttackTargetEntity);
    double At = 0; if (D->TryGetNumberField(TEXT("lastAttackAt"), At)) LastAttackAt = static_cast<float>(At);
    double Hit = 0; if (D->TryGetNumberField(TEXT("lastHitAt"), Hit)) LastHitAt = static_cast<float>(Hit);
    const auto P = D->GetObjectField(TEXT("pos")), V = D->GetObjectField(TEXT("velocity"));
    auto* Bridge = GetWorld()->GetSubsystem<UTVBridgeSubsystem>();
    const float Units = Bridge ? Bridge->UnitsPerMetre : 100.f;
    PreviousPosition = GetActorLocation();
    TargetPosition = Bridge ? Bridge->ToUnreal(FVector(P->GetNumberField(TEXT("x")), P->GetNumberField(TEXT("y")), P->GetNumberField(TEXT("z")))) : TargetPosition;
    CanonicalVelocity = FVector(V->GetNumberField(TEXT("x")), V->GetNumberField(TEXT("z")), V->GetNumberField(TEXT("y"))) * Units;
    // The walk/sprint speed the local prediction runs at is canonical, never a constant of this
    // client's own -- otherwise the predicted body leans permanently ahead of canonical truth.
    double Speed = 0; if (D->TryGetNumberField(TEXT("speed"), Speed) && Speed > 0) CanonicalSpeed = static_cast<float>(Speed) * Units;
    double Sprint = 0; if (D->TryGetNumberField(TEXT("sprintMultiplier"), Sprint) && Sprint > 0) CanonicalSprintMultiplier = static_cast<float>(Sprint);
    const float Yaw = D->GetNumberField(TEXT("yaw")); TargetYaw = FMath::RadiansToDegrees(FMath::Atan2(-FMath::Cos(Yaw), -FMath::Sin(Yaw)));
    SnapshotAge = 0; bProjected = true;
    if (First) { PreviousPosition = TargetPosition; SetActorLocation(TargetPosition, false, nullptr, ETeleportType::TeleportPhysics); }
    const TSharedPtr<FJsonObject>* Class;
    RecognisedClass.Empty(); ClassEvidence.Empty(); ClassConfidence = 0;
    if (D->TryGetObjectField(TEXT("recognisedClass"), Class) && Class->IsValid()) {
        (*Class)->TryGetStringField(TEXT("name"), RecognisedClass);
        ClassConfidence = static_cast<float>((*Class)->GetNumberField(TEXT("confidence")));
        const TArray<TSharedPtr<FJsonValue>>* Lines;
        if ((*Class)->TryGetArrayField(TEXT("evidence"), Lines)) for (const auto& L : *Lines) ClassEvidence += (ClassEvidence.IsEmpty() ? TEXT("") : TEXT("  -  ")) + L->AsString();
    }
    Nameplate->SetText(FText::FromString(DisplayName + (RecognisedClass.IsEmpty() ? TEXT("") : TEXT("  /  ") + RecognisedClass) + TEXT("\n") + Activity));
    const TSharedPtr<FJsonObject>* Debug;
    if (D->TryGetObjectField(TEXT("debug"), Debug)) { auto Writer = TJsonWriterFactory<>::Create(&DebugText); DebugText.Empty(); FJsonSerializer::Serialize(Debug->ToSharedRef(), Writer); }
}
void ATVCharacter::Animate(float Speed) {
    UAnimationAsset* Wanted = bIncapacitated ? DownAnimation.Get() : CanonicalPose == TEXT("attack") ? AttackAnimation.Get() : CanonicalPose == TEXT("hit") ? HitAnimation.Get() : Locomotion.Get();
    if (!Wanted) return;
    // A second swing or a second blow leaves the canonical pose unchanged, so replaying on a
    // pose transition alone would silently drop every hit after the first in an exchange.
    const bool Restart = (Wanted == AttackAnimation && LastAttackAt > PlayedAttackAt) || (Wanted == HitAnimation && LastHitAt > PlayedHitAt);
    if (CurrentAnimation != Wanted || Restart) {
        CurrentAnimation = Wanted; GetMesh()->PlayAnimation(Wanted, Wanted == Locomotion);
        if (Wanted == AttackAnimation) PlayedAttackAt = LastAttackAt;
        if (Wanted == HitAnimation) PlayedHitAt = LastHitAt;
    }
    if (Wanted == Locomotion) if (auto* Anim = GetMesh()->GetSingleNodeInstance()) Anim->SetBlendSpacePosition(FVector(Speed, 0, 0));
}
void ATVCharacter::SetupPlayerInputComponent(UInputComponent* I) {
    Super::SetupPlayerInputComponent(I);
    I->BindAxis(TEXT("Forward"), this, &ATVCharacter::Forward); I->BindAxis(TEXT("Right"), this, &ATVCharacter::Right);
    I->BindAxis(TEXT("Turn"), this, &ATVCharacter::Turn); I->BindAxis(TEXT("Look"), this, &ATVCharacter::Look); I->BindAxis(TEXT("Zoom"), this, &ATVCharacter::Zoom);
    I->BindAction(TEXT("Sprint"), IE_Pressed, this, &ATVCharacter::SprintOn); I->BindAction(TEXT("Sprint"), IE_Released, this, &ATVCharacter::SprintOff);
    I->BindAction(TEXT("Target"), IE_Pressed, this, &ATVCharacter::SelectTarget);
    I->BindAction(TEXT("Interact"), IE_Pressed, this, &ATVCharacter::Interact); I->BindAction(TEXT("Inspector"), IE_Pressed, this, &ATVCharacter::Inspector);
    I->BindAction(TEXT("Attack"), IE_Pressed, this, &ATVCharacter::Attack);
}
void ATVCharacter::Forward(float V) { ForwardAxis = V; } void ATVCharacter::Right(float V) { RightAxis = V; }
void ATVCharacter::Turn(float V) { AddControllerYawInput(V); } void ATVCharacter::Look(float V) { AddControllerPitchInput(V); }
void ATVCharacter::Zoom(float V) { ZoomTarget = FMath::Clamp(ZoomTarget - V * 100, 160.f, 1500.f); }
void ATVCharacter::SprintOn() { bSprint = true; } void ATVCharacter::SprintOff() { bSprint = false; }
void ATVCharacter::SelectTarget() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->CycleTarget(); }
void ATVCharacter::Interact() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->SendIntent(TEXT("interact")); }
void ATVCharacter::Inspector() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->bInspector = !B->bInspector; }
/** Intent only. Whether this swing reaches anyone, what it costs them, and whether they get back
 * up are all resolved by the TypeScript simulation on the same path an NPC's attack takes; this
 * client learns the outcome from the next snapshot like any other observer. */
void ATVCharacter::Attack() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->SendIntent(TEXT("attack")); }

