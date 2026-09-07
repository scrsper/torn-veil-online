#include "TVCharacter.h"
#include "TVBridgeSubsystem.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/TextRenderComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Animation/AnimSingleNodeInstance.h"
#include "Animation/AnimationAsset.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
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
    CameraBoom->TargetArmLength = 340; CameraBoom->SocketOffset = FVector(0, 45, 70); CameraBoom->bUsePawnControlRotation = true;
    // A narrow canonical entrance should pull the camera in gently, rather than pinning it to a
    // character's back.  Canonical solids still block the camera through ECC_Camera.
    CameraBoom->ProbeChannel = ECC_Camera; CameraBoom->ProbeSize = 8; CameraBoom->bEnableCameraLag = true; CameraBoom->CameraLagSpeed = 12;
    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera")); Camera->SetupAttachment(CameraBoom); Camera->FieldOfView = 75;
    Nameplate = CreateDefaultSubobject<UTextRenderComponent>(TEXT("CanonicalName")); Nameplate->SetupAttachment(RootComponent);
    Nameplate->SetRelativeLocation(FVector(0, 0, 125)); Nameplate->SetWorldSize(18); Nameplate->SetHorizontalAlignment(EHTA_Center); Nameplate->SetTextRenderColor(FColor(235, 210, 160));
    static ConstructorHelpers::FObjectFinder<USkeletalMesh> Humanoid(TEXT("/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple"));
    if (Humanoid.Succeeded()) GetMesh()->SetSkeletalMesh(Humanoid.Object);
    GetMesh()->SetRelativeLocation(FVector(0, 0, -90)); GetMesh()->SetRelativeRotation(FRotator(0, -90, 0)); GetMesh()->SetCollisionEnabled(ECollisionEnabled::NoCollision); GetMesh()->SetOwnerNoSee(true);
    HairProxy = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("AshfordHair")); HairProxy->SetupAttachment(GetMesh(), TEXT("head")); HairProxy->SetCollisionEnabled(ECollisionEnabled::NoCollision); HairProxy->SetOwnerNoSee(true);
    GarmentProxy = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("AshfordGarment")); GarmentProxy->SetupAttachment(GetMesh(), TEXT("spine_03")); GarmentProxy->SetCollisionEnabled(ECollisionEnabled::NoCollision); GarmentProxy->SetOwnerNoSee(true);
    OccupationProp = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("AshfordOccupationCue")); OccupationProp->SetupAttachment(GetMesh(), TEXT("hand_r")); OccupationProp->SetCollisionEnabled(ECollisionEnabled::NoCollision); OccupationProp->SetOwnerNoSee(true);
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cylinder(TEXT("/Engine/BasicShapes/Cylinder"));
    if (Cylinder.Succeeded()) HairProxy->SetStaticMesh(Cylinder.Object);
    if (Cube.Succeeded()) { GarmentProxy->SetStaticMesh(Cube.Object); OccupationProp->SetStaticMesh(Cube.Object); }
    HairProxy->SetRelativeLocation(FVector(0, 0, 5)); HairProxy->SetRelativeScale3D(FVector(.48f, .48f, .22f));
    GarmentProxy->SetRelativeLocation(FVector(2, 0, -8)); GarmentProxy->SetRelativeScale3D(FVector(.44f, .30f, .55f));
    OccupationProp->SetRelativeLocation(FVector(8, 4, -15)); OccupationProp->SetVisibility(false);
    static ConstructorHelpers::FObjectFinder<UMaterialInterface> Skin(TEXT("/Game/TornVeil/Materials/M_TV_CharacterSkin"));
    static ConstructorHelpers::FObjectFinder<UMaterialInterface> Cloth(TEXT("/Game/TornVeil/Materials/M_TV_CharacterCloth"));
    static ConstructorHelpers::FObjectFinder<UMaterialInterface> Hair(TEXT("/Game/TornVeil/Materials/M_TV_CharacterHair"));
    static ConstructorHelpers::FObjectFinder<UMaterialInterface> Prop(TEXT("/Game/TornVeil/Materials/M_TV_CharacterProp"));
    if (Skin.Succeeded()) { SkinMaterial = UMaterialInstanceDynamic::Create(Skin.Object, this); for (int32 Index = 0; Index < GetMesh()->GetNumMaterials(); ++Index) GetMesh()->SetMaterial(Index, SkinMaterial); }
    if (Cloth.Succeeded()) { ClothMaterial = UMaterialInstanceDynamic::Create(Cloth.Object, this); GarmentProxy->SetMaterial(0, ClothMaterial); }
    if (Hair.Succeeded()) { HairMaterial = UMaterialInstanceDynamic::Create(Hair.Object, this); HairProxy->SetMaterial(0, HairMaterial); }
    if (Prop.Succeeded()) { PropMaterial = UMaterialInstanceDynamic::Create(Prop.Object, this); OccupationProp->SetMaterial(0, PropMaterial); }
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
    const auto* Bridge = GetWorld() ? GetWorld()->GetSubsystem<UTVBridgeSubsystem>() : nullptr;
    if (!Controller || bIncapacitated || (Bridge && Bridge->bDialogueOpen)) return FVector::ZeroVector;
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
        ApplyNameplate(Bridge && Bridge->bInspector); // no-op unless F6 was toggled since the last snapshot
    }
    Animate(bCanonicalPlayer ? GetVelocity().Size2D() : (Live ? CanonicalVelocity.Size2D() : 0));
}
void ATVCharacter::Project(const TSharedPtr<FJsonObject>& D, bool First) {
    BodyId = D->GetStringField(TEXT("bodyId")); EntityId = D->GetStringField(TEXT("entityId")); DisplayName = D->GetStringField(TEXT("name"));
    Activity = D->GetStringField(TEXT("activity")); Occupation = D->GetStringField(TEXT("occupation")); CanonicalPose = D->GetStringField(TEXT("pose"));
    ApplyAppearance(D);
    Health = D->GetNumberField(TEXT("health")); MaxHealth = D->GetNumberField(TEXT("maxHealth"));
    bDead = D->GetBoolField(TEXT("dead")); bIncapacitated = D->GetBoolField(TEXT("incapacitated")) || bDead;
    AttackTargetEntity.Empty(); D->TryGetStringField(TEXT("attackTarget"), AttackTargetEntity); // null when not swinging
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
        if ((*Class)->TryGetArrayField(TEXT("evidence"), Lines)) for (const auto& L : *Lines) ClassEvidence += (ClassEvidence.IsEmpty() ? FString() : FString(TEXT("  -  "))) + L->AsString();
    }
    NameplateClassShown = -1; // name/activity may have changed; force a rewrite
    ApplyNameplate(Bridge && Bridge->bInspector);
    const TSharedPtr<FJsonObject>* Debug;
    if (D->TryGetObjectField(TEXT("debug"), Debug)) { auto Writer = TJsonWriterFactory<>::Create(&DebugText); DebugText.Empty(); FJsonSerializer::Serialize(Debug->ToSharedRef(), Writer); }
}
static FLinearColor TVHexColour(double Raw, const FLinearColor& Fallback) {
    if (!FMath::IsFinite(Raw) || Raw < 0) return Fallback;
    const uint32 Value = static_cast<uint32>(Raw);
    return FLinearColor(((Value >> 16) & 255) / 255.f, ((Value >> 8) & 255) / 255.f, (Value & 255) / 255.f, 1.f);
}
static FString TVOccupationCue(const FString& Occupation) {
    // Data, rather than a cast-name switch: current profile data is deliberately external so a
    // culture pack may change clothing/props without changing canonical character code.
    static bool bRead = false; static TMap<FString, FString> Cues;
    if (!bRead) {
        bRead = true; FString Text;
        const FString Path = FPaths::ProjectContentDir() / TEXT("TornVeil/Presentation/AshfordAppearanceProfiles.json");
        if (FFileHelper::LoadFileToString(Text, *Path)) {
            TSharedPtr<FJsonObject> Root;
            if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Root) && Root.IsValid()) {
                const TSharedPtr<FJsonObject>* Occupations;
                if (Root->TryGetObjectField(TEXT("occupations"), Occupations) && Occupations && Occupations->IsValid()) for (const auto& Pair : (*Occupations)->Values) {
                    const auto Row = Pair.Value->AsObject(); FString Cue;
                    if (Row && Row->TryGetStringField(TEXT("prop"), Cue)) Cues.Add(FString(Pair.Key.ToView()), Cue);
                }
            }
        }
    }
    return Cues.FindRef(Occupation);
}
void ATVCharacter::ApplyAppearance(const TSharedPtr<FJsonObject>& D) {
    const TSharedPtr<FJsonObject>* A;
    if (!D->TryGetObjectField(TEXT("appearance"), A) || !A || !A->IsValid()) return;
    double Value = 0;
    if (SkinMaterial && (*A)->TryGetNumberField(TEXT("skin"), Value)) SkinMaterial->SetVectorParameterValue(TEXT("Tint"), TVHexColour(Value, FLinearColor(.72f, .48f, .32f)));
    if (ClothMaterial && (*A)->TryGetNumberField(TEXT("shirt"), Value)) ClothMaterial->SetVectorParameterValue(TEXT("Tint"), TVHexColour(Value, FLinearColor(.08f, .12f, .26f)));
    if (HairMaterial && (*A)->TryGetNumberField(TEXT("hair"), Value)) HairMaterial->SetVectorParameterValue(TEXT("Tint"), TVHexColour(Value, FLinearColor(.04f, .025f, .016f)));
    float Height = 1.f, Build = 1.f;
    if ((*A)->TryGetNumberField(TEXT("height"), Value)) Height = FMath::Clamp(static_cast<float>(Value), .82f, 1.16f);
    if ((*A)->TryGetNumberField(TEXT("build"), Value)) Build = FMath::Clamp(static_cast<float>(Value), .82f, 1.18f);
    GetMesh()->SetRelativeScale3D(FVector(Build, Build, Height));
    GarmentProxy->SetRelativeScale3D(FVector(.44f * Build, .30f * Build, .55f * Height));
    HairProxy->SetRelativeScale3D(FVector(.48f * Build, .48f * Build, .22f * Height));
    FString Hat; (*A)->TryGetStringField(TEXT("hatStyle"), Hat);
    HairProxy->SetVisibility(!Hat.Equals(TEXT("hood"), ESearchCase::IgnoreCase));
    const FString Cue = TVOccupationCue(Occupation);
    const bool LongCue = Cue == TEXT("spear") || Cue == TEXT("bow") || Cue == TEXT("hoe") || Cue == TEXT("axe") || Cue == TEXT("sword");
    OccupationProp->SetVisibility(!Cue.IsEmpty());
    OccupationProp->SetRelativeScale3D(LongCue ? FVector(.075f, .075f, 1.2f) : FVector(.16f, .16f, .16f));
    if (PropMaterial) PropMaterial->SetVectorParameterValue(TEXT("Tint"), LongCue ? FLinearColor(.20f, .13f, .06f) : FLinearColor(.35f, .24f, .09f));
}
void ATVCharacter::ApplyNameplate(bool bShowClass) {
    if (NameplateClassShown == static_cast<int8>(bShowClass)) return;
    NameplateClassShown = static_cast<int8>(bShowClass);
    const FString Suffix = (bShowClass && !RecognisedClass.IsEmpty()) ? FString(TEXT("  /  ")) + RecognisedClass : FString();
    Nameplate->SetText(FText::FromString(DisplayName + Suffix + TEXT("\n") + Activity));
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
    I->BindAction(TEXT("Consume"), IE_Pressed, this, &ATVCharacter::Consume);
    I->BindAction(TEXT("Drop"), IE_Pressed, this, &ATVCharacter::Drop);
    I->BindAction(TEXT("Dialogue1"), IE_Pressed, this, &ATVCharacter::Dialogue1); I->BindAction(TEXT("Dialogue2"), IE_Pressed, this, &ATVCharacter::Dialogue2);
    I->BindAction(TEXT("Dialogue3"), IE_Pressed, this, &ATVCharacter::Dialogue3); I->BindAction(TEXT("Dialogue4"), IE_Pressed, this, &ATVCharacter::Dialogue4);
    I->BindAction(TEXT("Dialogue5"), IE_Pressed, this, &ATVCharacter::Dialogue5); I->BindAction(TEXT("CloseDialogue"), IE_Pressed, this, &ATVCharacter::CloseDialogue);
    I->BindAction(TEXT("Dialogue6"), IE_Pressed, this, &ATVCharacter::Dialogue6); I->BindAction(TEXT("Dialogue7"), IE_Pressed, this, &ATVCharacter::Dialogue7);
    I->BindAction(TEXT("Dialogue8"), IE_Pressed, this, &ATVCharacter::Dialogue8); I->BindAction(TEXT("Dialogue9"), IE_Pressed, this, &ATVCharacter::Dialogue9);
    I->BindAction(TEXT("Attack"), IE_Pressed, this, &ATVCharacter::Attack);
}
void ATVCharacter::Forward(float V) { ForwardAxis = V; } void ATVCharacter::Right(float V) { RightAxis = V; }
void ATVCharacter::Turn(float V) { AddControllerYawInput(V); } void ATVCharacter::Look(float V) { AddControllerPitchInput(V); }
void ATVCharacter::Zoom(float V) { ZoomTarget = FMath::Clamp(ZoomTarget - V * 100, 160.f, 1500.f); }
void ATVCharacter::SprintOn() { bSprint = true; } void ATVCharacter::SprintOff() { bSprint = false; }
void ATVCharacter::SelectTarget() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->CycleTarget(); }
void ATVCharacter::Consume() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->SendHandIntent(true); }
void ATVCharacter::Drop() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->SendDropIntent(); }
void ATVCharacter::Interact() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->Interact(); }
void ATVCharacter::Inspector() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->bInspector = !B->bInspector; }
void ATVCharacter::Dialogue1() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->ChooseDialogueOption(0); }
void ATVCharacter::Dialogue2() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->ChooseDialogueOption(1); }
void ATVCharacter::Dialogue3() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->ChooseDialogueOption(2); }
void ATVCharacter::Dialogue4() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->ChooseDialogueOption(3); }
void ATVCharacter::Dialogue5() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->ChooseDialogueOption(4); }
void ATVCharacter::Dialogue6() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->ChooseDialogueOption(5); }
void ATVCharacter::Dialogue7() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->ChooseDialogueOption(6); }
void ATVCharacter::Dialogue8() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->ChooseDialogueOption(7); }
void ATVCharacter::Dialogue9() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->ChooseDialogueOption(8); }
void ATVCharacter::CloseDialogue() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->CloseDialogue(); }
/** Intent only. Whether this swing reaches anyone, what it costs them, and whether they get back
 * up are all resolved by the TypeScript simulation on the same path an NPC's attack takes; this
 * client learns the outcome from the next snapshot like any other observer. */
void ATVCharacter::Attack() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->SendIntent(TEXT("attack")); }

