#include "TVWildlifePresentation.h"

#include "Animation/AnimationAsset.h"
#include "Animation/AnimSequence.h"
#include "Animation/AnimInstance.h"
#include "TVCombatAnimInstance.h"
#include "Components/SceneComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/SkeletalMesh.h"
#include "Serialization/JsonSerializer.h"

namespace {
static double Number(const TSharedPtr<FJsonObject>& Object, const TCHAR* Key, double Default = 0.) {
    double Value = Default;
    return Object.IsValid() && Object->TryGetNumberField(Key, Value) ? Value : Default;
}
static FString String(const TSharedPtr<FJsonObject>& Object, const TCHAR* Key) {
    FString Value;
    if (Object.IsValid()) Object->TryGetStringField(Key, Value);
    return Value;
}
static FVector CanonicalPosition(const TSharedPtr<FJsonObject>& Object) {
    return FVector(Number(Object, TEXT("x")), Number(Object, TEXT("z")), Number(Object, TEXT("y")));
}
static bool Bool(const TSharedPtr<FJsonObject>& Object, const TCHAR* Key, bool Default) {
    bool Value = Default;
    return Object.IsValid() && Object->TryGetBoolField(Key, Value) ? Value : Default;
}
static const TCHAR* AssetRoot = TEXT("/Game/TornVeil/Wildlife/Deer/");
}

ATVWildlifePresentation::ATVWildlifePresentation() {
    PrimaryActorTick.bCanEverTick = true;
    Mesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("DeerMesh"));
    SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("CanonicalFeet")));
    Mesh->SetupAttachment(RootComponent);
    Mesh->SetRelativeRotation(FRotator(0,-90,0)); // inspected source rig faces +Y
    Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Mesh->SetCanEverAffectNavigation(false);
    Mesh->SetGenerateOverlapEvents(false);
    Mesh->SetEnableGravity(false);
    Mesh->bEnableUpdateRateOptimizations = true;
    Tags.Add(TEXT("TV.Wildlife.PresentationOnly"));
}

void ATVWildlifePresentation::BeginPlay() {
    Super::BeginPlay();
    EnsureAssets();
}

void ATVWildlifePresentation::Tick(float DeltaSeconds) {
    const double TickStarted=FPlatformTime::Seconds();
    Super::Tick(DeltaSeconds);
    SnapshotAge += DeltaSeconds;
    if (!bPresent) {
        SetActorHiddenInGame(true);
        const double TickMs=(FPlatformTime::Seconds()-TickStarted)*1000.; TickTotalMs+=TickMs; TickMaxMs=FMath::Max(TickMaxMs,TickMs); ++TickSamples;
        return;
    }
    SetActorHiddenInGame(false);
    const float PositionInterp = bDead ? 24.f : 12.f;
    const FVector Expected=TargetPosition+(bDead?FVector::ZeroVector:TargetVelocity*FMath::Min(SnapshotAge,.1f));
    SetActorLocation(FVector::DistSquared(Expected,GetActorLocation())>FMath::Square(200.f)?Expected:FMath::VInterpTo(GetActorLocation(), Expected, DeltaSeconds, PositionInterp));
    SetActorRotation(FMath::RInterpTo(GetActorRotation(), FRotator(0.f, TargetYaw, 0.f), DeltaSeconds, 14.f));
    SelectAnimation();
    if(auto* Anim=Cast<UTVCombatAnimInstance>(Mesh->GetAnimInstance()))if(auto* Clip=Cast<UAnimSequence>(CurrentClip)){
        const bool Moving=TargetVelocity.Size2D()>1;
        const float Rate=Moving?FMath::Clamp(TargetVelocity.Size2D()/(Activity==TEXT("flee")?600.f:150.f),.5f,2.f):1.f;
        ClipTime+=DeltaSeconds*Rate;BlendAge+=DeltaSeconds;
        const float Length=FMath::Max(.001f,Clip->GetPlayLength());Anim->Time=bDead?FMath::Min(Length,ClipTime):FMath::Fmod(ClipTime,Length);
        Anim->Weight=FMath::Clamp(BlendAge/.14f,0.f,1.f);Anim->bSnapshot=BlendAge<.14f;
    }
    const double TickMs=(FPlatformTime::Seconds()-TickStarted)*1000.; TickTotalMs+=TickMs; TickMaxMs=FMath::Max(TickMaxMs,TickMs); ++TickSamples;
}

void ATVWildlifePresentation::EnsureAssets() {
    if (!Mesh->GetSkeletalMeshAsset()) {
        Mesh->SetSkeletalMesh(LoadObject<USkeletalMesh>(nullptr, TEXT("/Game/TornVeil/Wildlife/Deer/SKM_Deer.SKM_Deer")));
        if(auto* Asset=Mesh->GetSkeletalMeshAsset()){const auto Bounds=Asset->GetImportedBounds();ReferenceScale=BodyHeightCm/FMath::Max(1.,Bounds.BoxExtent.Z*2);
            Mesh->SetRelativeScale3D(FVector(ReferenceScale));Mesh->SetRelativeLocation(FVector(0,0,-(Bounds.Origin.Z-Bounds.BoxExtent.Z)*ReferenceScale));}
    }
    if (Clips.Num()) return;
    const TArray<TPair<FString, FString>> Sources = {
        { TEXT("idle"), TEXT("AN_Deer_Idle") }, { TEXT("idle_2"), TEXT("AN_Deer_Idle_2") },
        { TEXT("idle_headlow"), TEXT("AN_Deer_Idle_Headlow") }, { TEXT("walk"), TEXT("AN_Deer_Walk") },
        { TEXT("gallop"), TEXT("AN_Deer_Gallop") }, { TEXT("eating"), TEXT("AN_Deer_Eating") },
        { TEXT("death"), TEXT("AN_Deer_Death") }, { TEXT("hit"), TEXT("AN_Deer_Idle_HitReact1") },
    };
    for (const auto& Pair : Sources) {
        const FString Path = FString(AssetRoot) + Pair.Value + TEXT(".") + Pair.Value;
        if (UAnimationAsset* Asset = LoadObject<UAnimationAsset>(nullptr, *Path)) Clips.Add(Pair.Key, Asset);
    }
}

UAnimationAsset* ATVWildlifePresentation::ClipForActivity(const FString& CanonicalActivity) const {
    if (CanonicalActivity == TEXT("dead")) return Clips.FindRef(TEXT("death"));
    if (CanonicalActivity == TEXT("walk")) return Clips.FindRef(TEXT("walk"));
    if (CanonicalActivity == TEXT("flee") || CanonicalActivity == TEXT("roam")) return Clips.FindRef(TEXT("gallop"));
    if (CanonicalActivity == TEXT("eat") || CanonicalActivity == TEXT("forage")) return Clips.FindRef(TEXT("eating"));
    // The source pack has no drink/rest clip. Head-low idle is the restrained fallback.
    if (CanonicalActivity == TEXT("drink") || CanonicalActivity == TEXT("rest") || CanonicalActivity == TEXT("sleep")) return Clips.FindRef(TEXT("idle_headlow"));
    return Clips.FindRef(TEXT("idle"));
}

void ATVWildlifePresentation::SelectAnimation(bool bForce) {
    const FString Key = bDead ? TEXT("dead") : Activity;
    if (!bForce && Key == LastAnimationKey) return;
    LastAnimationKey = Key;
    CurrentClip = ClipForActivity(Key);
    if (CurrentClip) {
        FPoseSnapshot From;Mesh->SnapshotPose(From);
        if(!Cast<UTVCombatAnimInstance>(Mesh->GetAnimInstance()))Mesh->SetAnimInstanceClass(UTVCombatAnimInstance::StaticClass());
        auto* Anim=Cast<UTVCombatAnimInstance>(Mesh->GetAnimInstance());
        Anim->Base=Cast<UAnimSequence>(CurrentClip);Anim->Motion=Cast<UAnimSequence>(CurrentClip);Anim->Snapshot=From;
        Anim->bLocomotion=false;Anim->bFlow=false;Anim->FootLock=0;
        ClipTime=bSettleCorpse&&bDead?CastChecked<UAnimSequence>(CurrentClip)->GetPlayLength():0;BlendAge=bForce?1:0;bSettleCorpse=false;
    }
}

bool ATVWildlifePresentation::Project(const TSharedPtr<FJsonObject>& Data, const FVector& CanonicalOrigin, float UnitsPerMetre, bool bFirst) {
    if (!Data.IsValid() || UnitsPerMetre <= 0.f) return false;
    BodyId = String(Data, TEXT("bodyId")); CreatureId = String(Data, TEXT("creatureId")); SpeciesId = String(Data, TEXT("speciesId")); RegionId = String(Data, TEXT("regionId"));
    if (BodyId.IsEmpty() || CreatureId.IsEmpty() || SpeciesId.IsEmpty()) return false;
    Activity = String(Data, TEXT("activity")); Condition = FMath::Clamp(static_cast<float>(Number(Data, TEXT("condition"), 1.)), 0.f, 1.f);
    VisualScale = FMath::Clamp(static_cast<float>(Number(Data, TEXT("scale"), 1.)), .25f, 2.f);
    const TSharedPtr<FJsonObject>* Plan;if(Data->TryGetObjectField(TEXT("bodyPlan"),Plan))BodyHeightCm=Number(*Plan,TEXT("heightM"),1.5)*UnitsPerMetre;
    bAlive = Bool(Data, TEXT("alive"), !Bool(Data, TEXT("dead"), false)); bDead = Bool(Data, TEXT("dead"), !bAlive); bPresent = Bool(Data, TEXT("present"), true);
    const TSharedPtr<FJsonObject>* Position = nullptr;
    if (!Data->TryGetObjectField(TEXT("pos"), Position)) return false;
    TargetPosition = FVector(
        Number(*Position, TEXT("x")) - CanonicalOrigin.X,
        Number(*Position, TEXT("z")) - CanonicalOrigin.Z,
        Number(*Position, TEXT("y")) - CanonicalOrigin.Y) * UnitsPerMetre;
    const TSharedPtr<FJsonObject>* Velocity = nullptr;
    if (Data->TryGetObjectField(TEXT("vel"), Velocity)) TargetVelocity = CanonicalPosition(*Velocity) * UnitsPerMetre;
    const float CanonicalYaw = static_cast<float>(Number(Data, TEXT("yaw")));
    TargetYaw = FMath::RadiansToDegrees(FMath::Atan2(-FMath::Cos(CanonicalYaw), -FMath::Sin(CanonicalYaw)));
    SnapshotAge = 0.f;
    if (bFirst) { SetActorLocation(TargetPosition); SetActorRotation(FRotator(0.f, TargetYaw, 0.f)); }
    SetActorHiddenInGame(!bPresent);
    SetActorScale3D(FVector(VisualScale));
    bSettleCorpse=bFirst&&bDead;EnsureAssets(); SelectAnimation(bFirst);
    return true;
}

void ATVWildlifePresentation::SetCanonicalTransform(const FVector& PositionCm, float YawDegrees, const FVector& VelocityCmPerSecond) {
    TargetPosition = PositionCm; TargetYaw = YawDegrees; TargetVelocity = VelocityCmPerSecond; SnapshotAge = 0.f;
}

void ATVWildlifePresentation::RebasePresentation(const FVector& Delta) {
    TargetPosition += Delta; SetActorLocation(GetActorLocation() + Delta);
}

FString ATVWildlifePresentation::PresentationDiagnostics() const {
    auto J = MakeShared<FJsonObject>();
    J->SetStringField(TEXT("bodyId"), BodyId); J->SetStringField(TEXT("creatureId"), CreatureId);
    J->SetStringField(TEXT("speciesId"), SpeciesId); J->SetStringField(TEXT("regionId"), RegionId);
    J->SetStringField(TEXT("activity"), Activity); J->SetBoolField(TEXT("alive"), bAlive);
    J->SetBoolField(TEXT("dead"), bDead); J->SetBoolField(TEXT("present"), bPresent);
    J->SetNumberField(TEXT("condition"), Condition); J->SetNumberField(TEXT("speedCmPerSecond"), TargetVelocity.Size2D());
    J->SetNumberField(TEXT("snapshotAge"), SnapshotAge); J->SetNumberField(TEXT("scale"), VisualScale);
    J->SetNumberField(TEXT("referenceScale"),ReferenceScale);J->SetNumberField(TEXT("animationTime"),ClipTime);
    J->SetNumberField(TEXT("tickSamples"),TickSamples);J->SetNumberField(TEXT("tickMeanMs"),TickSamples?TickTotalMs/TickSamples:0);J->SetNumberField(TEXT("tickMaxMs"),TickMaxMs);
    J->SetStringField(TEXT("clip"),CurrentClip?CurrentClip->GetPathName():TEXT("MISSING REQUIRED DEER ASSET"));
    J->SetStringField(TEXT("positionCm"),GetActorLocation().ToString());J->SetStringField(TEXT("renderBounds"),Mesh->Bounds.GetBox().ToString());
    if(auto* Asset=Mesh->GetSkeletalMeshAsset())J->SetStringField(TEXT("importedBounds"),Asset->GetImportedBounds().GetBox().ToString());
    J->SetBoolField(TEXT("canonicalAuthority"), false); J->SetStringField(TEXT("asset"), TEXT("Quaternius CC0 deer; presentation-only"));
    FString Out; FJsonSerializer::Serialize(J, TJsonWriterFactory<>::Create(&Out)); return Out;
}
