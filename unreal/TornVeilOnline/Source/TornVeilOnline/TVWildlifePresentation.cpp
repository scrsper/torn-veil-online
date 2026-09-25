#include "TVWildlifePresentation.h"

#include "Animation/AnimationAsset.h"
#include "Animation/AnimSequence.h"
#include "Animation/AnimInstance.h"
#include "TVCombatAnimInstance.h"
#include "Components/SceneComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
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
    if (bPrimitive) {
        AnimatePrimitive(DeltaSeconds);
        const double TickMs=(FPlatformTime::Seconds()-TickStarted)*1000.; TickTotalMs+=TickMs; TickMaxMs=FMath::Max(TickMaxMs,TickMs); ++TickSamples;
        return;
    }
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
    // No boar or hare asset is installed on this machine: those species get the project-built
    // primitive body rather than a deer silhouette. Only the deer uses the licensed deer rig.
    if (SpeciesId == TEXT("woodland_boar") || SpeciesId == TEXT("field_hare")) {
        if (!bPrimitive) BuildPrimitive();
        return;
    }
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
    const TSharedPtr<FJsonObject>* Plan;if(Data->TryGetObjectField(TEXT("bodyPlan"),Plan)){BodyHeightCm=Number(*Plan,TEXT("heightM"),1.5)*UnitsPerMetre;BodyRadiusCm=Number(*Plan,TEXT("radiusM"),.38)*UnitsPerMetre;}
    { const FString NextDefense=String(Data,TEXT("defense")); if(NextDefense!=Defense) DefenseAge=0.f; Defense=NextDefense; bDefenseAtViewer=Bool(Data,TEXT("defenseAtViewer"),false); }
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

UStaticMeshComponent* ATVWildlifePresentation::AddPart(USceneComponent* Parent, const TCHAR* Shape, const FVector& Location, const FVector& ScaleCm, const FRotator& Rotation, const FLinearColor& Colour) {
    auto* Part = NewObject<UStaticMeshComponent>(this);
    Part->SetupAttachment(Parent);
    Part->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, *FString::Printf(TEXT("/Engine/BasicShapes/%s.%s"), Shape, Shape)));
    Part->SetRelativeLocation(Location); Part->SetRelativeRotation(Rotation); Part->SetRelativeScale3D(ScaleCm / 100.f); // basic shapes are 100 cm
    Part->SetCollisionEnabled(ECollisionEnabled::NoCollision); Part->SetCanEverAffectNavigation(false); Part->SetGenerateOverlapEvents(false);
    if (UMaterialInterface* Base = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"))) {
        auto* Instance = UMaterialInstanceDynamic::Create(Base, Part); Instance->SetVectorParameterValue(TEXT("Color"), Colour); Part->SetMaterial(0, Instance);
    }
    Part->RegisterComponent(); PrimitiveParts.Add(Part);
    return Part;
}

/** A stocky boar (or a small hare) in the canonical body plan's own dimensions. Facing +X. */
void ATVWildlifePresentation::BuildPrimitive() {
    bPrimitive = true; Mesh->SetVisibility(false); Mesh->SetComponentTickEnabled(false);
    PrimitiveRoot = NewObject<USceneComponent>(this); PrimitiveRoot->SetupAttachment(RootComponent); PrimitiveRoot->RegisterComponent();
    const bool bHare = SpeciesId == TEXT("field_hare");
    const float H = FMath::Max(20.f, BodyHeightCm), L = FMath::Max(30.f, BodyRadiusCm * 3.4f), W = bHare ? L * .45f : L * .42f;
    const FLinearColor Hide = bHare ? FLinearColor(.28f, .2f, .13f) : FLinearColor(.07f, .045f, .03f);
    const FLinearColor Muzzle = bHare ? FLinearColor(.4f, .32f, .24f) : FLinearColor(.2f, .12f, .1f);
    const float LegTop = H * (bHare ? .35f : .46f), TrunkZ = LegTop + H * (bHare ? .12f : .1f);
    // Trunk: heavier in the shoulder for a boar (two overlapping ellipsoids), long and low for a hare.
    AddPart(PrimitiveRoot, TEXT("Sphere"), FVector(L * .12f, 0, TrunkZ + (bHare ? 0 : H * .04f)), FVector(L * .72f, W, H * (bHare ? .42f : .52f)), FRotator::ZeroRotator, Hide);
    AddPart(PrimitiveRoot, TEXT("Sphere"), FVector(-L * .2f, 0, TrunkZ), FVector(L * .62f, W * .95f, H * (bHare ? .44f : .44f)), FRotator::ZeroRotator, Hide);
    HeadPivot = NewObject<USceneComponent>(this); HeadPivot->SetupAttachment(PrimitiveRoot);
    HeadPivot->SetRelativeLocation(FVector(L * .42f, 0, TrunkZ + H * (bHare ? .1f : .02f))); HeadPivot->RegisterComponent();
    AddPart(HeadPivot, TEXT("Sphere"), FVector(L * .1f, 0, 0), FVector(L * (bHare ? .28f : .36f), W * .75f, H * (bHare ? .28f : .34f)), FRotator::ZeroRotator, Hide);
    if (bHare) {
        for (const float Side : { -1.f, 1.f }) AddPart(HeadPivot, TEXT("Cylinder"), FVector(0, Side * W * .18f, H * .3f), FVector(W * .12f, W * .08f, H * .42f), FRotator(0, 0, Side * 8.f), Hide);
    } else {
        AddPart(HeadPivot, TEXT("Cylinder"), FVector(L * .3f, 0, -H * .05f), FVector(W * .38f, W * .38f, L * .2f), FRotator(-90, 0, 0), Muzzle); // snout
        for (const float Side : { -1.f, 1.f }) {
            AddPart(HeadPivot, TEXT("Cone"), FVector(L * .3f, Side * W * .2f, -H * .1f), FVector(W * .07f, W * .07f, H * .14f), FRotator(-35, 0, Side * 20.f), FLinearColor(.85f, .8f, .66f)); // tusks
            AddPart(HeadPivot, TEXT("Cone"), FVector(-L * .02f, Side * W * .26f, H * .16f), FVector(W * .16f, W * .07f, H * .14f), FRotator(0, 0, Side * 25.f), Hide); // ears
        }
        AddPart(PrimitiveRoot, TEXT("Cylinder"), FVector(-L * .52f, 0, TrunkZ + H * .05f), FVector(W * .06f, W * .06f, H * .2f), FRotator(35, 0, 0), Hide); // tail
    }
    // Four hips; each leg hangs from its hip so a hip rotation swings the whole leg.
    const float LegLength = LegTop, Front = L * (bHare ? .22f : .3f), Back = -L * (bHare ? .28f : .34f);
    for (const FVector2D At : { FVector2D(Front, -W * .3f), FVector2D(Front, W * .3f), FVector2D(Back, -W * .3f), FVector2D(Back, W * .3f) }) {
        auto* Hip = NewObject<USceneComponent>(this); Hip->SetupAttachment(PrimitiveRoot); Hip->SetRelativeLocation(FVector(At.X, At.Y, LegTop)); Hip->RegisterComponent();
        AddPart(Hip, TEXT("Cylinder"), FVector(0, 0, -LegLength * .5f), FVector(W * (bHare ? .16f : .2f), W * (bHare ? .16f : .2f), LegLength), FRotator::ZeroRotator, Hide);
        Hips.Add(Hip);
    }
}

/** Gait from canonical velocity; readable display, charge, wind-up/thrust and death poses. */
void ATVWildlifePresentation::AnimatePrimitive(float DeltaSeconds) {
    if (!PrimitiveRoot) return;
    DefenseAge += DeltaSeconds;
    const float L = FMath::Max(30.f, BodyRadiusCm * 3.4f);
    if (bDead) {
        PrimitiveRoot->SetRelativeRotation(FMath::RInterpTo(PrimitiveRoot->GetRelativeRotation(), FRotator(0, 0, 88), DeltaSeconds, 4.f));
        PrimitiveRoot->SetRelativeLocation(FMath::VInterpTo(PrimitiveRoot->GetRelativeLocation(), FVector(0, 0, BodyRadiusCm * .6f), DeltaSeconds, 4.f));
        for (USceneComponent* Hip : Hips) Hip->SetRelativeRotation(FRotator(0, 0, 0));
        return;
    }
    const float Speed = TargetVelocity.Size2D();
    const bool Charging = Defense == TEXT("charge"), Striking = Defense == TEXT("strike"), Warning = Defense == TEXT("warn");
    GaitPhase += DeltaSeconds * Speed / FMath::Max(20.f, L * .9f) * 2.f * PI;
    const float Swing = FMath::Clamp(Speed / 300.f, 0.f, 1.f) * (Charging ? 48.f : 32.f);
    for (int32 i = 0; i < Hips.Num(); ++i) {
        const float Offset = (i == 0 || i == 3) ? 0.f : PI; // diagonal pairs
        float Pitch = FMath::Sin(GaitPhase + Offset) * Swing;
        if (Warning && i == 0) { StompPhase += DeltaSeconds * 5.f; Pitch = FMath::Max(0.f, FMath::Sin(StompPhase)) * 22.f; } // pawing the ground
        Hips[i]->SetRelativeRotation(FRotator(Pitch, 0, 0));
    }
    // Head: lowered while bristling or charging; a strike draws back through its wind-up (0.55 s),
    // then drives forward and up (0.22 s) — the moment to be out of its line.
    float HeadPitch = 0.f, HeadForward = 0.f;
    if (Warning) HeadPitch = -18.f;
    if (Charging) HeadPitch = -26.f;
    if (Striking) {
        if (DefenseAge < .55f) { const float T = DefenseAge / .55f; HeadPitch = -26.f + 14.f * T; HeadForward = -L * .08f * T; }
        else { const float T = FMath::Clamp((DefenseAge - .55f) / .22f, 0.f, 1.f); HeadPitch = -12.f + 40.f * T; HeadForward = -L * .08f + L * .26f * T; }
    }
    const FVector HeadBase(L * .42f, 0, HeadPivot->GetRelativeLocation().Z);
    HeadPivot->SetRelativeRotation(FMath::RInterpTo(HeadPivot->GetRelativeRotation(), FRotator(HeadPitch, 0, 0), DeltaSeconds, Striking ? 30.f : 10.f));
    HeadPivot->SetRelativeLocation(FMath::VInterpTo(HeadPivot->GetRelativeLocation(), HeadBase + FVector(HeadForward, 0, 0), DeltaSeconds, Striking ? 30.f : 10.f));
    // Bristling: the whole body bulks up a little; a small bob while moving.
    const float Bulk = Warning || Charging ? 1.06f : 1.f;
    PrimitiveRoot->SetRelativeScale3D(FMath::VInterpTo(PrimitiveRoot->GetRelativeScale3D(), FVector(1.f, Bulk, Bulk), DeltaSeconds, 6.f));
    PrimitiveRoot->SetRelativeLocation(FVector(0, 0, FMath::Abs(FMath::Sin(GaitPhase)) * FMath::Clamp(Speed / 300.f, 0.f, 1.f) * 3.f));
    PrimitiveRoot->SetRelativeRotation(FRotator::ZeroRotator);
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
    J->SetStringField(TEXT("defense"),Defense);J->SetBoolField(TEXT("defenseAtViewer"),bDefenseAtViewer);
    J->SetBoolField(TEXT("canonicalAuthority"), false); J->SetStringField(TEXT("asset"), bPrimitive ? TEXT("project-built primitive body (no licensed asset installed for this species)") : TEXT("Quaternius CC0 deer; presentation-only"));
    FString Out; FJsonSerializer::Serialize(J, TJsonWriterFactory<>::Create(&Out)); return Out;
}
