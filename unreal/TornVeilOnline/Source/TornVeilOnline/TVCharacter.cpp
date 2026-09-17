#include "TVCharacter.h"
#include "TVCombatPresentationComponent.h"
#include "TVCombatAnimInstance.h"
#include "Misc/CoreDelegates.h"
#include "GameFramework/InputSettings.h"
#include "GameFramework/PlayerController.h"
#include "TVInteractionSpec.generated.h"
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
#include "Animation/BlendSpace.h"
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
    GetCharacterMovement()->bOrientRotationToMovement = false; GetCharacterMovement()->RotationRate = FRotator(0, 540, 0);
    GetCharacterMovement()->MaxWalkSpeed = 460; GetCharacterMovement()->MaxStepHeight = 105;
    GetCharacterMovement()->BrakingDecelerationWalking = 6000; GetCharacterMovement()->MaxAcceleration = 6000;
    GetCharacterMovement()->GroundFriction = 12;
    CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom")); CameraBoom->SetupAttachment(RootComponent);
    CameraBoom->TargetArmLength = 340; CameraBoom->SocketOffset = FVector(0, 45, 70); CameraBoom->bUsePawnControlRotation = false;CameraBoom->SetUsingAbsoluteRotation(true);
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
    static ConstructorHelpers::FObjectFinder<UAnimationAsset> Sprint(TEXT("/Game/TornVeil/Combat/Repair/Animations/A_TV_Sprint")); SprintAnimation=Sprint.Object;
    for(const TCHAR* Name:{TEXT("CrouchEnter"),TEXT("CrouchIdle"),TEXT("CrouchMoveF"),TEXT("CrouchMoveB"),TEXT("CrouchMoveL"),TEXT("CrouchMoveR")}){
        const FString Path=FString(TEXT("/Game/TornVeil/Combat/Refinement/Animations/A_TV_"))+Name;CrouchAnimations.Add(Name,LoadObject<UAnimationAsset>(nullptr,*Path));
    }
    static ConstructorHelpers::FObjectFinder<UAnimationAsset> Atk(TEXT("/Game/Characters/Mannequins/Anims/Unarmed/Attack/MM_Attack_01")); AttackAnimation = Atk.Object;
    static ConstructorHelpers::FObjectFinder<UAnimationAsset> Hit(TEXT("/Game/TornVeil/Characters/Animations/A_TV_HitReact_Front")); HitAnimation = Hit.Object;
    static ConstructorHelpers::FObjectFinder<UAnimationAsset> Down(TEXT("/Game/TornVeil/Characters/Animations/A_TV_Downed")); DownAnimation = Down.Object;
    // Canonically visible bodies must finish their presentation even while camera-culled.
    GetMesh()->VisibilityBasedAnimTickOption = EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones;
    // Slice 3. The visible character sits alongside the driver on the capsule with the driver's
    // own relative transform, so a resolved human occupies exactly the space the mannequin did.
    VisibleCharacter = CreateDefaultSubobject<UTVCharacterPresentation>(TEXT("VisibleCharacter"));
    VisibleCharacter->SetupAttachment(GetCapsuleComponent());
    VisibleCharacter->SetRelativeLocation(FVector(0, 0, -90));
    VisibleCharacter->SetRelativeRotation(FRotator(0, -90, 0));
    VisibleCharacter->SetVisibility(false);
    VisibleMeshBaseLocation = FVector(0, 0, -90);
}
void ATVCharacter::BeginPlay() {
    Super::BeginPlay();
    FCoreDelegates::ApplicationWillDeactivateDelegate.AddUObject(this,&ATVCharacter::LoseFocus);
    // Manny supplies the humanoid silhouette. The old cube/cylinder placeholders
    // obscure articulated limbs and are deferred until fitted clothing exists.
    HairProxy->SetHiddenInGame(true); GarmentProxy->SetHiddenInGame(true); OccupationProp->SetHiddenInGame(true);
    if (VisibleCharacter) VisibleCharacter->BindDriver(GetMesh());
    GetCharacterMovement()->DisableMovement(); GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    if (IsPlayerControlled()) { bCanonicalPlayer = true; Controller->SetControlRotation(FRotator(-18, 0, 0)); Nameplate->SetVisibility(false); }
    else { GetCharacterMovement()->DisableMovement(); GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision); }
}
FVector ATVCharacter::IntentDirection() const {
    const auto* Bridge = GetWorld() ? GetWorld()->GetSubsystem<UTVBridgeSubsystem>() : nullptr;
    if (!Controller || bIncapacitated || (Bridge && Bridge->HasModalScreen())) return FVector::ZeroVector;
    const FRotationMatrix Basis(FRotator(0, GetActorRotation().Yaw, 0));
    return (Basis.GetUnitAxis(EAxis::X) * ForwardAxis + Basis.GetUnitAxis(EAxis::Y) * RightAxis).GetClampedToMaxSize(1);
}
void ATVCharacter::Tick(float Dt) {
    Super::Tick(Dt); SnapshotAge += Dt;
    auto* Bridge = GetWorld()->GetSubsystem<UTVBridgeSubsystem>();
    const bool Live = Bridge && Bridge->IsLive();
    if(IsPlayerControlled())RefreshInputContext(!Bridge||!Bridge->HasPrediction()||Bridge->HasModalScreen());
    if (bCanonicalPlayer) {
        GetCharacterMovement()->MaxWalkSpeed = CanonicalSpeed;
        // Physical movement is entirely canonical. Local gravity/collision must not compete with reconciliation.
        if (bProjected && Controller && Bridge && Bridge->HasPrediction()) {
            const double CameraYaw=FMath::DegreesToRadians(Controller->GetControlRotation().Yaw);
            Bridge->PredictMovement(Dt,IntentDirection(),bSprint,FMath::Atan2(-FMath::Cos(CameraYaw),-FMath::Sin(CameraYaw)));
            CanonicalCrouch=Bridge->PredictedCrouch();
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
        const float Alpha = FMath::Clamp(SnapshotAge / (GetWorld()->GetTimeSeconds()<CombatMotionUntil?1.f/30:.1f), 0.f, 1.f);
        SetActorLocation(FMath::Lerp(PreviousPosition, TargetPosition, Alpha));
        SetActorRotation(FMath::RInterpTo(GetActorRotation(), FRotator(0, TargetYaw, 0), Dt, 10));
        if (auto* PC = GetWorld()->GetFirstPlayerController()) { const auto R = (PC->PlayerCameraManager->GetCameraLocation() - Nameplate->GetComponentLocation()).Rotation(); Nameplate->SetWorldRotation(R); }
        Nameplate->SetVisibility(Bridge && Bridge->Selected()==this && !Bridge->bArena);
        ApplyNameplate(Bridge && Bridge->bInspector); // no-op unless F6 was toggled since the last snapshot
        ApplyOccupancyOffset(Dt);
    }
    // Desired yaw still goes through canonical facing limits. The camera follows the
    // resulting body yaw, including commitment, while pitch is view-only.
    if(bCanonicalPlayer&&Controller)CameraBoom->SetWorldRotation(FRotator(Controller->GetControlRotation().Pitch,GetActorRotation().Yaw,0));
    const FVector BeforeChoreography=GetActorLocation();
    const bool bChoreography=CombatPresentation->Present(Dt);
    MaxChoreographyActorDriftCm=FMath::Max(MaxChoreographyActorDriftCm,static_cast<float>(FVector::Dist(BeforeChoreography,GetActorLocation())));
    FTVLocomotionCameraSample PresentationSample;
    PresentationSample.Velocity=CanonicalVelocity;PresentationSample.PreviousVelocity=PreviousPresentationVelocity;
    PresentationSample.BodyYawDegrees=GetActorRotation().Yaw;PresentationSample.PreviousBodyYawDegrees=PreviousPresentationYaw;
    PresentationSample.DeltaSeconds=Dt;PresentationSample.bGrounded=true;PresentationSample.bCrouched=CanonicalCrouch>.001;
    PresentationSample.bDead=bDead;PresentationSample.bDowned=bIncapacitated;
    PresentationSample.CombatPhase=bChoreography?ETVPresentationCombatPhase::Active:ETVPresentationCombatPhase::None;
    LocomotionCameraSignal=FTVLocomotionCameraPresentation::Derive(PresentationSample);
    PreviousPresentationVelocity=CanonicalVelocity;PreviousPresentationYaw=GetActorRotation().Yaw;
    bPresentationTransitionPending|=LocomotionCameraSignal.Transition!=ETVPresentationTransition::None;
    if(LocomotionCameraSignal.Transition==ETVPresentationTransition::Stop)PresentationFootPlant=1;
    else if(LocomotionCameraSignal.Transition==ETVPresentationTransition::Pivot)PresentationFootPlant=FMath::Max(PresentationFootPlant,.45f);
    else PresentationFootPlant=FMath::Max(0.f,PresentationFootPlant-Dt*5);
    if(bCanonicalPlayer) {
        if(LocomotionCameraSignal.Transition==ETVPresentationTransition::Pivot)CameraShoulderSign=LocomotionCameraSignal.CameraShoulderSign;
        const float ArmTarget=LocomotionCameraSignal.CameraMode==ETVPresentationCameraMode::Combat?FMath::Min(ZoomTarget,300.f)
            :LocomotionCameraSignal.CameraMode==ETVPresentationCameraMode::Incapacitated?FMath::Max(ZoomTarget,390.f):ZoomTarget;
        CameraBoom->TargetArmLength=FMath::FInterpTo(CameraBoom->TargetArmLength,ArmTarget,Dt,8);
        const float Shoulder=FMath::GetMappedRangeValueClamped(FVector2D(160,700),FVector2D(55,0),ArmTarget)*CameraShoulderSign;
        CameraBoom->SocketOffset.Y=FMath::FInterpTo(CameraBoom->SocketOffset.Y,Shoulder,Dt,7);
    }
    if (!bChoreography) {
        // Returning from the native choreography instance must restore the ordinary pose player.
        if (bWasChoreography) CurrentAnimation=nullptr;
        if(CanonicalCrouch>.001&&!bIncapacitated)AnimateCrouch(CanonicalCrouch,Dt);
        else Animate(Live ? CanonicalVelocity.Size2D() : 0);
    }
    bWasChoreography=bChoreography;
}
void ATVCharacter::ProjectCombatMotion(const TSharedPtr<FJsonObject>& D) {
    if(bCanonicalPlayer)return;
    const auto* Bridge=GetWorld()->GetSubsystem<UTVBridgeSubsystem>();const auto P=D->GetObjectField(TEXT("pos")),V=D->GetObjectField(TEXT("vel"));
    PreviousPosition=GetActorLocation();TargetPosition=Bridge->ToUnreal(FVector(P->GetNumberField(TEXT("x")),P->GetNumberField(TEXT("y")),P->GetNumberField(TEXT("z"))));
    CanonicalVelocity=FVector(V->GetNumberField(TEXT("x")),V->GetNumberField(TEXT("z")),V->GetNumberField(TEXT("y")))*100;
    const double Yaw=D->GetNumberField(TEXT("yaw"));TargetYaw=FMath::RadiansToDegrees(FMath::Atan2(-FMath::Cos(Yaw),-FMath::Sin(Yaw)));
    SnapshotAge=0;CombatMotionUntil=GetWorld()->GetTimeSeconds()+.15;
}
void ATVCharacter::Project(const TSharedPtr<FJsonObject>& D, bool First) {
    FTVHumanoidVisualState State; FString ParseError;
    if (!FTVHumanoidVisualState::Parse(D, State, ParseError)) {
        UE_LOG(LogTemp, Warning, TEXT("TV_CHARACTER rejected malformed body projection: %s"), *ParseError);
        return;
    }
    BodyId = State.BodyId; EntityId = State.EntityId; DisplayName = State.Name;
    D->TryGetNumberField(TEXT("crouch"),CanonicalCrouch);
    Activity = State.Activity; Occupation.Empty(); D->TryGetStringField(TEXT("occupation"), Occupation); CanonicalPose = State.Pose;
    ApplyAppearance(State.Appearance);
    // Slice 3 embodiment. A malformed block is logged and dropped: the character then keeps its
    // previous appearance and activity rather than silently resolving to a default person.
    const TSharedPtr<FJsonObject>* EmbodimentJson = nullptr;
    if (D->TryGetObjectField(TEXT("embodiment"), EmbodimentJson) && EmbodimentJson) {
        FTVEmbodimentState Parsed; FString EmbodimentError;
        if (FTVEmbodimentState::Parse(*EmbodimentJson, Parsed, EmbodimentError)) {
            Embodiment = MoveTemp(Parsed); bHasEmbodiment = true;
            if (VisibleCharacter && Embodiment.bHasAppearance) VisibleCharacter->ApplyProfile(Embodiment.Appearance);
        } else {
            UE_LOG(LogTemp, Warning, TEXT("TV_CHARACTER rejected malformed embodiment for %s: %s"), *State.BodyId, *EmbodimentError);
        }
    }
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
    if (First) {
        PreviousPosition = TargetPosition; SetActorLocation(TargetPosition, false, nullptr, ETeleportType::TeleportPhysics);
        if(bCanonicalPlayer && Bridge && Bridge->bArena)ZoomTarget=480; // entire stance remains visible in practice
    }
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
void ATVCharacter::ApplyOccupancyOffset(float Dt) {
    if (!VisibleCharacter || bCanonicalPlayer || !bHasEmbodiment) return;
    auto* Bridge = GetWorld() ? GetWorld()->GetSubsystem<UTVBridgeSubsystem>() : nullptr;
    if (!Bridge) return;
    // The bridge has already bounded every one of these to MAX_SETTLE_METRES against canonical
    // geometry (src/bridge/occupancy.ts); this clamp is a second, local guarantee that a bad
    // projection can never move a character out of the space the simulation put it in.
    const float LimitCm = 125.f;
    FVector WantedCm = FVector::ZeroVector;
    float WantedYaw = 0.f;
    const FVector Canonical = GetActorLocation();
    if (Embodiment.Station.bValid) {
        WantedCm = Bridge->ToUnreal(Embodiment.Station.StandMetres) - Canonical;
        WantedYaw = FMath::RadiansToDegrees(Embodiment.Station.Yaw);
    } else if (Embodiment.bHasConversation) {
        WantedCm = Bridge->ToUnreal(Embodiment.ConversationStandMetres) - Canonical;
        WantedYaw = FMath::RadiansToDegrees(Embodiment.ConversationYaw);
    } else {
        WantedCm = FVector(Embodiment.Separation.X, Embodiment.Separation.Y, 0.f) * 100.f;
    }
    WantedCm.Z = 0.f;
    if (WantedCm.SizeSquared() > LimitCm * LimitCm) WantedCm = WantedCm.GetSafeNormal() * LimitCm;
    // Ease rather than snap: a character that teleports a metre sideways when it stops walking
    // reads worse than one standing slightly off its station for half a second.
    OccupancyOffsetCm = FMath::VInterpTo(OccupancyOffsetCm, WantedCm, Dt, 6.f);
    OccupancyYawOffsetDegrees = FMath::FInterpTo(OccupancyYawOffsetDegrees, WantedYaw, Dt, 6.f);
    const FVector LocalOffset = GetActorRotation().UnrotateVector(OccupancyOffsetCm);
    VisibleCharacter->SetRelativeLocation(VisibleMeshBaseLocation + FVector(LocalOffset.X, LocalOffset.Y, 0.f));
    GetMesh()->SetRelativeLocation(VisibleMeshBaseLocation + FVector(LocalOffset.X, LocalOffset.Y, 0.f));
}
void ATVCharacter::ApplyNameplate(bool bShowClass) {
    if (NameplateClassShown == static_cast<int8>(bShowClass)) return;
    NameplateClassShown = static_cast<int8>(bShowClass);
    const FString Suffix = (bShowClass && !RecognisedClass.IsEmpty()) ? FString(TEXT("  /  ")) + RecognisedClass : FString();
    Nameplate->SetText(FText::FromString(DisplayName + Suffix + TEXT("\n") + Activity));
}
void ATVCharacter::Animate(float Speed) {
    if(!bDirectionalLocomotion){if(auto* Asset=LoadObject<UAnimationAsset>(nullptr,TEXT("/Game/Characters/TornVeilLocomotion/BS_TV_Directional"))){Locomotion=Asset;bDirectionalLocomotion=true;}}
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
    // Sprint can be slower after exertion/injury. Select the gait from intent/pose,
    // then time-scale the clip to actual canonical speed; preserve walk/jog mapping.
    const bool Sprinting=(bCanonicalPlayer?bSprint:CanonicalPose==TEXT("run"))&&GetActorRotation().UnrotateVector(CanonicalVelocity).X/FMath::Max(1.f,Speed)>.7f;
    if(!bDirectionalLocomotion&&Wanted==Locomotion&&Sprinting&&CanonicalCrouch<.01&&Speed>30&&SprintAnimation)Wanted=SprintAnimation;
    const FVector LocalTravel=GetActorRotation().UnrotateVector(CanonicalVelocity);
    const float Direction=Speed>5?FMath::RadiansToDegrees(FMath::Atan2(LocalTravel.Y,LocalTravel.X)):LastTravelDirection;
    if(bDirectionalLocomotion&&Wanted==Locomotion&&CanonicalCrouch<.01){
        const auto Transition=LocomotionCameraSignal.Transition;
        if(Transition!=ETVPresentationTransition::None){
            const FString D=FMath::Abs(Direction)<45?TEXT("F"):FMath::Abs(Direction)>135?TEXT("B"):Direction<0?TEXT("LL"):TEXT("RL");
            const FString Name=Transition==ETVPresentationTransition::Pivot?FString(TEXT("Walk/M_Relaxed_Walk_Turn_180_"))+(LocomotionCameraSignal.SignedYawDeltaDegrees<0?TEXT("L"):TEXT("R"))+TEXT("_Lfoot")
                :FString(TEXT("Walk/M_Relaxed_Walk_"))+(Transition==ETVPresentationTransition::Start?TEXT("Start_"):TEXT("Stop_"))+D+TEXT("_Lfoot");
            FString Short=Name.RightChop(Name.Find(TEXT("/"))+1);
            LocomotionTransition=LoadObject<UAnimSequence>(nullptr,*(TEXT("/Game/Characters/TornVeilLocomotion/RT_")+Short));LocomotionTransitionAge=0;
        }
        LocomotionTransitionAge+=GetWorld()->GetDeltaSeconds();
        if(LocomotionTransition&&LocomotionTransitionAge<.24f)Wanted=LocomotionTransition;
    }
    if(Speed>5)LastTravelDirection=Direction;
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
    if(Wanted==Locomotion||Wanted==SprintAnimation||Wanted==LocomotionTransition){
        FPoseSnapshot From;const bool Changed=CurrentAnimation!=Wanted||bPresentationTransitionPending;
        if(Changed){GetMesh()->SnapshotPose(From);PoseBlendAge=0;}
        if(!Cast<UTVCombatAnimInstance>(GetMesh()->GetAnimInstance()))GetMesh()->SetAnimInstanceClass(UTVCombatAnimInstance::StaticClass());
        auto* Anim=Cast<UTVCombatAnimInstance>(GetMesh()->GetAnimInstance());if(!Anim)return;
        if(Changed)Anim->Snapshot=From;
        const float Dt=GetWorld()->GetDeltaSeconds();PoseBlendAge+=Dt;LocomotionTime+=Dt*Speed/700.f;
        Anim->bSnapshot=PoseBlendAge<.1f;Anim->Weight=FMath::Clamp(PoseBlendAge/.1f,0.f,1.f);Anim->FootLock=PresentationFootPlant;
        Anim->Base=Cast<UAnimSequence>(SprintAnimation);Anim->bLocomotion=Wanted==Locomotion;
        Anim->Locomotion=Cast<UBlendSpace>(Locomotion);
        const FVector Local=GetActorRotation().UnrotateVector(CanonicalVelocity);
        Anim->LocomotionPosition=FVector(FMath::RadiansToDegrees(FMath::Atan2(Local.Y,Local.X)),Speed,0);
        Anim->Motion=Cast<UAnimSequence>(SprintAnimation);Anim->Time=FMath::Fmod(LocomotionTime,FMath::Max(.001f,Anim->Motion->GetPlayLength()));
        if(Wanted==LocomotionTransition){Anim->bLocomotion=false;Anim->Motion=LocomotionTransition;
            const float Length=LocomotionTransition->GetPlayLength();
            Anim->Time=FMath::Min(Length,LocomotionTransitionAge+(Speed<5?FMath::Max(0.f,Length-.24f):0));}
        // Combat's sequence/pose handoff and engine BlendSpace remain one maintained AnimGraph.
        // IgnoreRootMotion extracts/discards sample displacement; only the body/predictor moves.
        CurrentAnimation=Wanted;bPresentationTransitionPending=false;return;
    }
    if (CurrentAnimation != Wanted || Restart) {
        CurrentAnimation = Wanted; GetMesh()->PlayAnimation(Wanted, Wanted == Locomotion || Wanted==SprintAnimation || ActivityLoop);
        PresentationAnimationAge = 0.f;
        if (bReplayAttack) { --PendingAttackEvents; ++PlayedAttackEvents; }
        if (bReplayHit) { --PendingHitEvents; ++PlayedHitEvents; }
        PendingAttackPresentation = PendingAttackEvents; PendingHitPresentation = PendingHitEvents;
    }
    // BS_Idle_Walk_Run is two-dimensional: X = direction, Y = speed (cm/s).
    if(Wanted==SprintAnimation)if(auto* Anim=GetMesh()->GetSingleNodeInstance())Anim->SetPlayRate(Speed/700.f);
    if (Wanted == Locomotion) if (auto* Anim = GetMesh()->GetSingleNodeInstance()) {
        const FVector Local=GetActorRotation().UnrotateVector(CanonicalVelocity);const float FallbackDirection=FMath::RadiansToDegrees(FMath::Atan2(Local.Y,Local.X));
        Anim->SetBlendSpacePosition(FVector(FallbackDirection,Speed,0));
    }
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
    // Slice 3 evidence. `visibleCharacter` false means the palette resolved nothing and the driver
    // silhouette is what is on screen — never reported as a successful embodiment.
    J->SetStringField(TEXT("activityFamily"), bHasEmbodiment ? Embodiment.Activity.Family : FString());
    J->SetStringField(TEXT("activityDetail"), bHasEmbodiment ? Embodiment.Activity.Detail : FString());
    J->SetStringField(TEXT("activityPosture"), bHasEmbodiment ? Embodiment.Activity.Posture : FString());
    J->SetStringField(TEXT("stationKind"), bHasEmbodiment && Embodiment.Station.bValid ? Embodiment.Station.Kind : FString());
    J->SetStringField(TEXT("appearanceSignature"), bHasEmbodiment ? Embodiment.AppearanceSignature : FString());
    J->SetBoolField(TEXT("visibleCharacter"), VisibleCharacter && VisibleCharacter->HasVisibleCharacter());
    J->SetStringField(TEXT("embodiment"), VisibleCharacter ? VisibleCharacter->EmbodimentDiagnostics() : FString());
    J->SetNumberField(TEXT("occupancyOffsetCm"), OccupancyOffsetCm.Size2D());
    J->SetNumberField(TEXT("heldCrouch"),CanonicalCrouch);J->SetNumberField(TEXT("facingDegrees"),GetActorRotation().Yaw);J->SetNumberField(TEXT("desiredYaw"),Controller?Controller->GetControlRotation().Yaw:0);J->SetNumberField(TEXT("cameraYaw"),CameraBoom->GetComponentRotation().Yaw);
    J->SetNumberField(TEXT("speedCmPerSecond"), CanonicalVelocity.Size2D());
    J->SetBoolField(TEXT("directionalLocomotion"),bDirectionalLocomotion);
    if(auto* Anim=Cast<UTVCombatAnimInstance>(GetMesh()->GetAnimInstance())){
        J->SetNumberField(TEXT("blendDirection"),Anim->LocomotionPosition.X);J->SetNumberField(TEXT("blendSpeed"),Anim->LocomotionPosition.Y);
        J->SetNumberField(TEXT("animationTime"),Anim->bLocomotion?Anim->EvaluatedLocomotionTime:Anim->Time);
    }
    J->SetNumberField(TEXT("presentationGait"),static_cast<int32>(LocomotionCameraSignal.Gait));
    J->SetNumberField(TEXT("presentationTransition"),static_cast<int32>(LocomotionCameraSignal.Transition));
    J->SetNumberField(TEXT("presentationCameraMode"),static_cast<int32>(LocomotionCameraSignal.CameraMode));
    J->SetNumberField(TEXT("presentationAcceleration"),LocomotionCameraSignal.AccelerationCentimetersPerSecondSquared);
    J->SetBoolField(TEXT("rootMotionAllowed"),LocomotionCameraSignal.bRootMotionAllowed);
    J->SetBoolField(TEXT("actorTranslationAuthority"),LocomotionCameraSignal.bActorTranslationAuthority);
    J->SetNumberField(TEXT("movementMode"), static_cast<int32>(GetCharacterMovement()->MovementMode));
    if (const auto* HumanoidMesh = GetMesh()->GetSkeletalMeshAsset()) J->SetStringField(TEXT("mesh"), HumanoidMesh->GetPathName());
    if (const auto* Anim = GetMesh()->GetSingleNodeInstance()) J->SetNumberField(TEXT("animationTime"), Anim->GetCurrentTime());
    const FVector P = GetActorLocation(); auto V = MakeShared<FJsonObject>();
    V->SetNumberField(TEXT("x"), P.X); V->SetNumberField(TEXT("y"), P.Y); V->SetNumberField(TEXT("z"), P.Z); J->SetObjectField(TEXT("position"), V);
    FString Out; FJsonSerializer::Serialize(J, TJsonWriterFactory<>::Create(&Out)); return Out;
}
void ATVCharacter::SetupPlayerInputComponent(UInputComponent* I) {
    Super::SetupPlayerInputComponent(I);
    SetupEnhancedInput(I);
}
void ATVCharacter::Forward(float V) { if(V!=ForwardAxis)if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->NoteInput();ForwardAxis = V; } void ATVCharacter::Right(float V) { if(V!=RightAxis)if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->NoteInput();RightAxis = V; }
void ATVCharacter::Turn(float V) { AddControllerYawInput(V); } void ATVCharacter::Look(float V) { AddControllerPitchInput(V); }
void ATVCharacter::Zoom(float V) { ZoomTarget = FMath::Clamp(ZoomTarget - V * 100, 160.f, 1500.f); }
void ATVCharacter::SprintOn() { bSprint = true;if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->NoteInput(); } void ATVCharacter::SprintOff() { bSprint = false;if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->NoteInput(); }
void ATVCharacter::SelectTarget() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->CycleTarget(); }
void ATVCharacter::Consume() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->SendHandIntent(true); }
void ATVCharacter::Drop() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->SendDropIntent(); }
void ATVCharacter::Interact() { if (auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->Interact(); }
void ATVCharacter::Inventory(){if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->ToggleInventory();}
void ATVCharacter::PauseMenu(){if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->TogglePause();}
void ATVCharacter::UIBack(){if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->UIBack();}
void ATVCharacter::UIUp(){if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->UIMove(-1);}
void ATVCharacter::UIDown(){if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->UIMove(1);}
void ATVCharacter::UIConfirm(){if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->UIConfirm();}
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
/** Input starts disposable prediction immediately. TypeScript alone establishes later contact. */
void ATVCharacter::Attack(){const double At=FPlatformTime::Seconds();if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->SendCombat(TEXT("attack"),1,TEXT("high"),At);}
void ATVCharacter::LowAttack(){const double At=FPlatformTime::Seconds();if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->SendCombat(TEXT("attack"),1,TEXT("low"),At);}
void ATVCharacter::SidestepLeft(){const double At=FPlatformTime::Seconds();if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->SendCombat(TEXT("sidestep"),-1,TEXT("high"),At);}
void ATVCharacter::SidestepRight(){const double At=FPlatformTime::Seconds();if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->SendCombat(TEXT("sidestep"),1,TEXT("high"),At);}
void ATVCharacter::Backstep(){const double At=FPlatformTime::Seconds();if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->SendCombat(TEXT("backstep"),1,TEXT("high"),At);}
void ATVCharacter::Duck(){if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->SetCrouch(true);}


void ATVCharacter::RebasePresentation(const FVector& Delta) { TargetPosition+=Delta; PreviousPosition+=Delta; SetActorLocation(GetActorLocation()+Delta); }

void ATVCharacter::Mechanisms() { if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->ToggleMechanisms(); }
void ATVCharacter::SaveWorld() { if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>()) B->SaveWorld(); }

void ATVCharacter::Dodge() {
    const double At=FPlatformTime::Seconds();auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>();auto* PC=Cast<APlayerController>(Controller);
    if(!B||!PC||B->HasModalScreen())return;
    // Freeze the Enhanced Input axes; later camera/stick changes cannot steer the dodge.
    FVector D(ForwardAxis,RightAxis,0);
    if(D.Size()<TVInteractionSpec::dodgeDeadZone){B->SendCombat(TEXT("backstep"),1,TEXT("high"),At);return;}
    D.Normalize();D=FRotationMatrix(FRotator(0,GetActorRotation().Yaw,0)).TransformVector(D);
    B->SendCombat(TEXT("sidestep"),1,TEXT("high"),At,FVector(D.X,0,D.Y));
}

void ATVCharacter::PracticePassive(){if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->SetPractice(TEXT("passive"));}

void ATVCharacter::PracticeRepeat(){if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->SetPractice(TEXT("repeat"));}

void ATVCharacter::PracticeReset(){if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->SetPractice(TEXT("reset"));}

void ATVCharacter::EndPlay(const EEndPlayReason::Type Reason){FCoreDelegates::ApplicationWillDeactivateDelegate.RemoveAll(this);Super::EndPlay(Reason);}
void ATVCharacter::ReleaseCrouch(){if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->SetCrouch(false);}
void ATVCharacter::LoseFocus(){if(!bCanonicalPlayer)return;ForwardAxis=RightAxis=0;bSprint=bHeavyTrigger=false;ReleaseCrouch();if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->ClearBufferedInput();if(auto* PC=Cast<APlayerController>(Controller))PC->FlushPressedKeys();}
void ATVCharacter::HeavyTrigger(float V){if(V>=.65f&&!bHeavyTrigger){bHeavyTrigger=true;LowAttack();}else if(V<=.25f)bHeavyTrigger=false;}
void ATVCharacter::PracticePhysiology(){if(auto* B=GetWorld()->GetSubsystem<UTVBridgeSubsystem>())B->SetPractice(B->bPracticeRecovery?TEXT("normal"):TEXT("recovery"));}
void ATVCharacter::AnimateCrouch(float Amount,float Dt){
 const float Speed=CanonicalVelocity.Size2D();CrouchTime+=Dt*(Speed>10?Speed/150.f:1.f);FString Key=TEXT("CrouchEnter");float Time=Amount*.2f;
 if(Amount>.99){
    Key=TEXT("CrouchIdle");Time=CrouchTime;
    if(Speed>10){const auto V=GetActorRotation().UnrotateVector(CanonicalVelocity);Key=FMath::Abs(V.X)>FMath::Abs(V.Y)?(V.X>0?TEXT("CrouchMoveF"):TEXT("CrouchMoveB")):(V.Y>0?TEXT("CrouchMoveR"):TEXT("CrouchMoveL"));Time=CrouchTime;}
 }
 auto* Clip=Cast<UAnimSequence>(CrouchAnimations.FindRef(Key));if(!Clip)return;
 FPoseSnapshot From;const bool Changed=CurrentAnimation!=Clip;if(Changed){GetMesh()->SnapshotPose(From);PoseBlendAge=0;}
 if(!Cast<UTVCombatAnimInstance>(GetMesh()->GetAnimInstance()))GetMesh()->SetAnimInstanceClass(UTVCombatAnimInstance::StaticClass());
 auto* Anim=Cast<UTVCombatAnimInstance>(GetMesh()->GetAnimInstance());if(!Anim)return;
 if(Changed)Anim->Snapshot=From;PoseBlendAge+=Dt;Anim->bSnapshot=PoseBlendAge<.08f;Anim->bLocomotion=false;
 Anim->Base=Clip;Anim->Motion=Clip;Anim->BaseTime=Anim->Time=Key==TEXT("CrouchEnter")?Time:FMath::Fmod(Time,FMath::Max(.001f,Clip->GetPlayLength()));Anim->Weight=FMath::Clamp(PoseBlendAge/.08f,0.f,1.f);Anim->FootLock=0;CurrentAnimation=Clip;PreviousCrouch=Amount;
}
