#include "TVCombatPresentationComponent.h"
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
#include "Animation/AnimSequence.h"
#include "Engine/SkeletalMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Camera/PlayerCameraManager.h"
#include "GameFramework/PlayerController.h"
#include "UObject/ConstructorHelpers.h"
#include "TVHumanoidVisualState.h"

ATVCharacter::ATVCharacter() {
    PrimaryActorTick.bCanEverTick = true;
    CombatPresentation = CreateDefaultSubobject<UTVCombatPresentationComponent>(TEXT("CombatPresentation"));
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
    GetMesh()->SetRelativeLocation(FVector(0, 0, -90)); GetMesh()->SetRelativeRotation(FRotator(0, -90, 0)); GetMesh()->SetCollisionEnabled(ECollisionEnabled::NoCollision); GetMesh()->SetOwnerNoSee(false);
    HairProxy = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("AshfordHair")); HairProxy->SetupAttachment(GetMesh(), TEXT("head")); HairProxy->SetCollisionEnabled(ECollisionEnabled::NoCollision); HairProxy->SetOwnerNoSee(false);
    GarmentProxy = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("AshfordGarment")); GarmentProxy->SetupAttachment(GetMesh(), TEXT("spine_03")); GarmentProxy->SetCollisionEnabled(ECollisionEnabled::NoCollision); GarmentProxy->SetOwnerNoSee(false);
    OccupationProp = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("AshfordOccupationCue")); OccupationProp->SetupAttachment(GetMesh(), TEXT("hand_r")); OccupationProp->SetCollisionEnabled(ECollisionEnabled::NoCollision); OccupationProp->SetOwnerNoSee(false);
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
    static ConstructorHelpers::FObjectFinder<UAnimationAsset> Hit(TEXT("/Game/TornVeil/Characters/Animations/A_TV_HitReact_Front")); HitAnimation = Hit.Object;
    static ConstructorHelpers::FObjectFinder<UAnimationAsset> Down(TEXT("/Game/TornVeil/Characters/Animations/A_TV_Downed")); DownAnimation = Down.Object;
    // Canonically visible bodies must finish their presentation even while camera-culled.
    GetMesh()->VisibilityBasedAnimTickOption = EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones;
}
void ATVCharacter::BeginPlay() {
    Super::BeginPlay();
    // Manny supplies the humanoid silhouette. The old cube/cylinder placeholders
    // obscure articulated limbs and are deferred until fitted clothing exists.
    HairProxy->SetHiddenInGame(true); GarmentProxy->SetHiddenInGame(true); OccupationProp->SetHiddenInGame(true);
    GetCharacterMovement()->DisableMovement(); GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
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
    const bool Live = Bridge && Bridge->IsLive();
    if (bCanonicalPlayer) {
        CameraBoom->TargetArmLength = FMath::FInterpTo(CameraBoom->TargetArmLength, ZoomTarget, Dt, 8);
        CameraBoom->SocketOffset.Y = FMath::GetMappedRangeValueClamped(FVector2D(160, 700), FVector2D(55, 0), ZoomTarget);
        GetCharacterMovement()->MaxWalkSpeed = CanonicalSpeed;
        // Physical movement is entirely canonical. Local gravity/collision must not compete with reconciliation.
        if (bProjected && Bridge->HasPrediction()) {
            Bridge->PredictMovement(Dt,IntentDirection(),bSprint);
            Bridge->RenderCorrection=FMath::VInterpTo(Bridge->RenderCorrection,FVector::ZeroVector,Dt,15);
            SetActorLocation(Bridge->PredictedLocation()+Bridge->RenderCorrection,false);
            SetActorRotation(FRotator(0,Bridge->PredictedYaw(),0));
            CanonicalVelocity=Bridge->PredictionVelocity;
        } else if (bProjected && Live) {
            const FVector Expected = TargetPosition + CanonicalVelocity * FMath::Min(SnapshotAge, 0.1f);
            const FVector Error = Expected - GetActorLocation();
            SetActorRotation(FMath::RInterpTo(GetActorRotation(),FRotator(0,TargetYaw,0),Dt,10));
            if (Error.Size() > 250) SetActorLocation(Expected, false, nullptr, ETeleportType::TeleportPhysics);
            else SetActorLocation(GetActorLocation() + Error * FMath::Min(Dt * 6, 1.f), false);
        }
    } else if (bProjected) {
        const float Alpha = FMath::Clamp(SnapshotAge / 0.1f, 0.f, 1.f);
        SetActorLocation(FMath::Lerp(PreviousPosition, TargetPosition, Alpha));
        SetActorRotation(FMath::RInterpTo(GetActorRotation(), FRotator(0, TargetYaw, 0), Dt, 10));
        if (auto* PC = GetWorld()->GetFirstPlayerController()) { const auto R = (PC->PlayerCameraManager->GetCameraLocation() - Nameplate->GetComponentLocation()).Rotation(); Nameplate->SetWorldRotation(R); }
        Nameplate->SetVisibility(Bridge && Bridge->Selected()==this);
        ApplyNameplate(Bridge && Bridge->bInspector); // no-op unless F6 was toggled since the last snapshot
    }
    const FVector BeforeChoreography=GetActorLocation();
    const bool bChoreography=CombatPresentation->Present(Dt);
    MaxChoreographyActorDriftCm=FMath::Max(MaxChoreographyActorDriftCm,static_cast<float>(FVector::Dist(BeforeChoreography,GetActorLocation())));
    if (!bChoreography) {
        // Returning from the native choreography instance must restore the ordinary pose player.
        if (GetMesh()->GetAnimationMode()!=EAnimationMode::AnimationSingleNode) CurrentAnimation=nullptr;
        Animate(Live ? CanonicalVelocity.Size2D() : 0);
    }
}
void ATVCharacter::Project(const TSharedPtr<FJsonObject>& D, bool First) {
    FTVHumanoidVisualState State; FString ParseError;
    if (!FTVHumanoidVisualState::Parse(D, State, ParseError)) {
        UE_LOG(LogTemp, Warning, TEXT("TV_CHARACTER rejected malformed body projection: %s"), *ParseError);
        return;
    }
    BodyId = State.BodyId; EntityId = State.EntityId; DisplayName = State.Name;
    Activity = State.Activity; Occupation.Empty(); D->TryGetStringField(TEXT("occupation"), Occupation); CanonicalPose = State.Pose;
    ApplyAppearance(State.Appearance);
    double H=0, MaxH=0; D->TryGetNumberField(TEXT("health"),H); D->TryGetNumberField(TEXT("maxHealth"),MaxH); Health=H; MaxHealth=MaxH;
    bDead = State.bDead; bIncapacitated = State.bIncapacitated || bDead;
    AttackTargetEntity.Empty(); D->TryGetStringField(TEXT("attackTarget"), AttackTargetEntity); // null when not swinging
    LastAttackAt = static_cast<float>(State.LastAttackAt); LastHitAt = static_cast<float>(State.LastHitAt);
    const int64 NewAttackSeq = FMath::Max<int64>(AttackSeq, State.AttackSeq);
    const int64 NewHitSeq = FMath::Max<int64>(HitSeq, State.HitSeq);
    if (First || bSemanticCombat) { AttackSeq = NewAttackSeq; HitSeq = NewHitSeq; PendingAttackEvents=0; PendingHitEvents=0; }
    else {
        const int64 AvailableAttacks = PendingAttackEvents + NewAttackSeq - AttackSeq;
        const int64 AvailableHits = PendingHitEvents + NewHitSeq - HitSeq;
        PendingAttackEvents = FTVHumanoidVisualState::PendingDelta(AttackSeq, NewAttackSeq, PendingAttackEvents);
        PendingHitEvents = FTVHumanoidVisualState::PendingDelta(HitSeq, NewHitSeq, PendingHitEvents);
        SkippedAttackEvents += AvailableAttacks - PendingAttackEvents;
        SkippedHitEvents += AvailableHits - PendingHitEvents;
        AttackSeq = NewAttackSeq; HitSeq = NewHitSeq;
    }
    if (bIncapacitated) {
        SkippedAttackEvents += PendingAttackEvents; SkippedHitEvents += PendingHitEvents;
        PendingAttackEvents = 0; PendingHitEvents = 0;
    }
    PresentationAttackSeq = AttackSeq; PresentationHitSeq = HitSeq;
    PendingAttackPresentation = PendingAttackEvents; PendingHitPresentation = PendingHitEvents;
    auto* Bridge = GetWorld()->GetSubsystem<UTVBridgeSubsystem>();
    const float Units = Bridge ? Bridge->UnitsPerMetre : 100.f;
    PreviousPosition = GetActorLocation();
    TargetPosition = Bridge ? Bridge->ToUnreal(State.Position) : TargetPosition;
    CanonicalVelocity = FVector(State.Velocity.X, State.Velocity.Z, State.Velocity.Y) * Units;
    // Speed is derived from canonical velocity for presentation; no sprint tuning leaks into Unreal.
    CanonicalSpeed = CanonicalVelocity.Size2D();
    const float Yaw = State.Yaw; TargetYaw = FMath::RadiansToDegrees(FMath::Atan2(-FMath::Cos(Yaw), -FMath::Sin(Yaw)));
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
void ATVCharacter::ApplyAppearance(const FTVAppearanceVisualState& A) {
    if (!A.bPresent) return;
    if (SkinMaterial) SkinMaterial->SetVectorParameterValue(TEXT("Tint"), TVHexColour(A.Skin, FLinearColor(.72f, .48f, .32f)));
    if (ClothMaterial) ClothMaterial->SetVectorParameterValue(TEXT("Tint"), TVHexColour(A.Shirt, FLinearColor(.08f, .12f, .26f)));
    if (HairMaterial) HairMaterial->SetVectorParameterValue(TEXT("Tint"), TVHexColour(A.Hair, FLinearColor(.04f, .025f, .016f)));
    const float Height = A.Height, Build = A.Build;
    GetMesh()->SetRelativeScale3D(FVector(Build, Build, Height));
    GarmentProxy->SetRelativeScale3D(FVector(.44f * Build, .30f * Build, .55f * Height));
    HairProxy->SetRelativeScale3D(FVector(.48f * Build, .48f * Build, .22f * Height));
    HairProxy->SetVisibility(!A.HatStyle.Equals(TEXT("hood"), ESearchCase::IgnoreCase));
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
    PresentationAnimationAge += GetWorld() ? GetWorld()->GetDeltaSeconds() : 0.f;
    const auto ClipDuration = [](UAnimationAsset* Asset, float Fallback) {
        const auto* Sequence = Cast<UAnimSequence>(Asset);
        return Sequence ? FMath::Max(.1f, Sequence->GetPlayLength()) : Fallback;
    };
    const float HitDuration = ClipDuration(HitAnimation, .40f);
    const float AttackDuration = ClipDuration(AttackAnimation, .45f);
    const bool bPlayingHit = !bIncapacitated && CurrentAnimation == HitAnimation && PresentationAnimationAge < HitDuration;
    const bool bPlayingAttack = !bIncapacitated && CurrentAnimation == AttackAnimation && PresentationAnimationAge < AttackDuration;
    const bool bReplayHit = !bIncapacitated && !bPlayingHit && !bPlayingAttack && PendingHitEvents > 0;
    const bool bReplayAttack = !bIncapacitated && !bPlayingHit && !bPlayingAttack && !bReplayHit && PendingAttackEvents > 0;
    UAnimationAsset* Wanted = bIncapacitated ? DownAnimation.Get() : bPlayingHit || bReplayHit ? HitAnimation.Get() : bPlayingAttack || bReplayAttack ? AttackAnimation.Get() : Locomotion.Get();
    const bool ActivityLoop = Wanted == Locomotion && !bIncapacitated && Speed<30 && CanonicalPose!=TEXT("attack") && CanonicalPose!=TEXT("hit");
    if(ActivityLoop) {
        FString Key=Activity;
        if(Key==TEXT("sit") || Key==TEXT("sleep") || Key==TEXT("pray")) Key=TEXT("rest");
        if(!Key.IsEmpty() && Key!=TEXT("stand")) { if(!ActivityAnimations.Contains(Key)) ActivityAnimations.Add(Key,LoadObject<UAnimationAsset>(nullptr,*(TEXT("/Game/Characters/TornVeilActivities/A_TV_")+Key))); if(auto* A=ActivityAnimations.FindRef(Key).Get()) Wanted=A; }
    }
    if (!Wanted) return;
    // Sequence deltas preserve multiple swings/flinches even when pose stayed unchanged between
    // bridge snapshots; the bounded queues keep a burst from monopolizing presentation.
    const bool Restart = bReplayAttack || bReplayHit;
    if (CurrentAnimation != Wanted || Restart) {
        CurrentAnimation = Wanted; GetMesh()->PlayAnimation(Wanted, Wanted == Locomotion || ActivityLoop);
        PresentationAnimationAge = 0.f;
        if (bReplayAttack) { --PendingAttackEvents; ++PlayedAttackEvents; }
        if (bReplayHit) { --PendingHitEvents; ++PlayedHitEvents; }
        PendingAttackPresentation = PendingAttackEvents; PendingHitPresentation = PendingHitEvents;
    }
    // BS_Idle_Walk_Run is two-dimensional: X = direction, Y = speed (cm/s).
    if (Wanted == Locomotion) if (auto* Anim = GetMesh()->GetSingleNodeInstance()) Anim->SetBlendSpacePosition(FVector(0, Speed, 0));
}
FString ATVCharacter::PresentationAnimation() const { if (!CombatPresentation->AnimationPath().IsEmpty()) return CombatPresentation->AnimationPath(); return CurrentAnimation ? CurrentAnimation->GetPathName() : FString(); }
FString ATVCharacter::PresentationDiagnostics() const {
    auto J = MakeShared<FJsonObject>();
    J->SetStringField(TEXT("bodyId"), BodyId); J->SetStringField(TEXT("entityId"), EntityId);
    J->SetStringField(TEXT("pose"), CanonicalPose); J->SetStringField(TEXT("animation"), PresentationAnimation());
    J->SetBoolField(TEXT("possessed"), IsPlayerControlled()); J->SetBoolField(TEXT("incapacitated"), bIncapacitated); J->SetBoolField(TEXT("dead"), bDead);
    J->SetNumberField(TEXT("attackSeq"), AttackSeq); J->SetNumberField(TEXT("hitSeq"), HitSeq);
    J->SetNumberField(TEXT("playedAttacks"), PlayedAttackEvents+CombatPresentation->PlayedAttacks); J->SetNumberField(TEXT("playedHits"), PlayedHitEvents+CombatPresentation->PlayedHits);
    CombatPresentation->WriteDiagnostics(J);
    J->SetNumberField(TEXT("maxChoreographyActorDriftCm"),MaxChoreographyActorDriftCm);
    J->SetNumberField(TEXT("pendingAttacks"), PendingAttackEvents+CombatPresentation->PendingAttacks()); J->SetNumberField(TEXT("pendingHits"), PendingHitEvents+CombatPresentation->PendingHits());
    if (const auto* Anim = GetMesh()->GetSingleNodeInstance()) {
        FVector Input, Filtered; Anim->GetBlendSpaceState(Input, Filtered);
        J->SetNumberField(TEXT("blendDirection"), Input.X); J->SetNumberField(TEXT("blendSpeed"), Input.Y);
        J->SetNumberField(TEXT("filteredBlendSpeed"), Filtered.Y);
    }
    const FVector LeftFoot = GetMesh()->GetSocketTransform(TEXT("foot_l"), RTS_Component).GetLocation();
    const FVector RightFoot = GetMesh()->GetSocketTransform(TEXT("foot_r"), RTS_Component).GetLocation();
    J->SetNumberField(TEXT("footSeparationCm"), FVector::Dist(LeftFoot, RightFoot));
    J->SetNumberField(TEXT("headHeightCm"), GetMesh()->GetSocketTransform(TEXT("head"), RTS_Component).GetLocation().Z);
    J->SetNumberField(TEXT("pelvisHeightCm"), GetMesh()->GetSocketTransform(TEXT("pelvis"), RTS_Component).GetLocation().Z);
    J->SetNumberField(TEXT("skippedAttacks"), SkippedAttackEvents); J->SetNumberField(TEXT("skippedHits"), SkippedHitEvents);
    J->SetNumberField(TEXT("speedCmPerSecond"), CanonicalVelocity.Size2D());
    J->SetNumberField(TEXT("movementMode"), static_cast<int32>(GetCharacterMovement()->MovementMode));
    if (const auto* HumanoidMesh = GetMesh()->GetSkeletalMeshAsset()) J->SetStringField(TEXT("mesh"), HumanoidMesh->GetPathName());
    if (const auto* Anim = GetMesh()->GetSingleNodeInstance()) J->SetNumberField(TEXT("animationTime"), Anim->GetCurrentTime());
    const FVector P = GetActorLocation(); auto V = MakeShared<FJsonObject>();
    V->SetNumberField(TEXT("x"), P.X); V->SetNumberField(TEXT("y"), P.Y); V->SetNumberField(TEXT("z"), P.Z); J->SetObjectField(TEXT("position"), V);
    FString Out; FJsonSerializer::Serialize(J, TJsonWriterFactory<>::Create(&Out)); return Out;
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
    I->BindKey(EKeys::M,IE_Pressed,this,&ATVCharacter::Mechanisms);
    I->BindKey(EKeys::F5,IE_Pressed,this,&ATVCharacter::SaveWorld);
    I->BindAction(TEXT("Attack"), IE_Pressed, this, &ATVCharacter::Attack);
}
void ATVCharacter::Forward(float V) { if(V!=ForwardAxis)if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->NoteInput();ForwardAxis = V; } void ATVCharacter::Right(float V) { if(V!=RightAxis)if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->NoteInput();RightAxis = V; }
void ATVCharacter::Turn(float V) { AddControllerYawInput(V); } void ATVCharacter::Look(float V) { AddControllerPitchInput(V); }
void ATVCharacter::Zoom(float V) { ZoomTarget = FMath::Clamp(ZoomTarget - V * 100, 160.f, 1500.f); }
void ATVCharacter::SprintOn() { bSprint = true;if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->NoteInput(); } void ATVCharacter::SprintOff() { bSprint = false;if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->NoteInput(); }
void ATVCharacter::SelectTarget() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->CycleTarget(); }
void ATVCharacter::Consume() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->SendHandIntent(true); }
void ATVCharacter::Drop() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->SendDropIntent(); }
void ATVCharacter::Interact() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->Interact(); }
void ATVCharacter::Inspector() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) { B->bInspector = !B->bInspector; if(B->bInspector) B->RequestDeveloperInspection(); } }
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


void ATVCharacter::RebasePresentation(const FVector& Delta) { TargetPosition+=Delta; PreviousPosition+=Delta; SetActorLocation(GetActorLocation()+Delta); }

void ATVCharacter::Mechanisms() { if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->ToggleMechanisms(); }
void ATVCharacter::SaveWorld() { if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->SaveWorld(); }
