// Development runtime observer. No OS input, intentions, actor relocation, or canonical writes.
// Runs in editor -game and packaged Development clients; Editor Python is not required.
#include "CoreMinimal.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "TVBridgeSubsystem.h"
#include "TVCharacter.h"
#include "TVPlayableLighting.h"
#include "TVWorldProjection.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Camera/PlayerCameraManager.h"
#include "Engine/StaticMesh.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Engine/SkeletalMesh.h"
#include "EngineUtils.h"
#include "UnrealClient.h"
#include "GameFramework/PlayerController.h"
#include "Containers/Ticker.h"
#include "HAL/IConsoleManager.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonSerializer.h"

namespace TVAlphaCapture {
static bool Running = false, Requested = false;
static double Started = 0, ReadyAt = 0, ShotAt = 0;
static double DeadlineSeconds = 110;
static double ObserveSeconds = 0, ObserveAt = 0, LastObservedFrame = 0;
static int32 AsyncObservedFrames = 0, StaleObservedFrames = 0;
static TArray<double> FrameDts;
static int32 Shot = 0, Frames = 0, MaxShots = 1;
static FString Directory, ImagePath;
static TSharedPtr<FJsonObject> Report;
static TArray<TSharedPtr<FJsonValue>> Captures;
static TWeakObjectPtr<ACameraActor> Camera;
static TSharedPtr<FJsonObject> Parse(const FString& Text);
static TArray<TSharedPtr<FJsonValue>> Vector(const FVector& V);
static double AlignmentAt = 0;
/** Worst observed part-to-body bone separation per person and pose (cm), over the whole observation. */
struct FAlign { double MaxCm = 0; FString Part, Bone; int32 Samples = 0; FVector Scale = FVector::OneVector; };
static TMap<FString, TMap<FString, FAlign>> Alignment;
static const TCHAR* AlignedBones[] = {TEXT("head"), TEXT("neck_01"), TEXT("spine_05"), TEXT("pelvis"), TEXT("hand_l"), TEXT("hand_r"),
    TEXT("calf_l"), TEXT("calf_r"), TEXT("foot_l"), TEXT("foot_r"), TEXT("ball_l"), TEXT("ball_r")};
static FString PoseKey(ATVCharacter* Person) {
    auto D = Parse(Person->PresentationDiagnostics());
    FString Pose = D->GetStringField(TEXT("pose"));
    if (D->GetBoolField(TEXT("dead"))) return TEXT("dead");
    if (D->GetBoolField(TEXT("incapacitated"))) return TEXT("downed");
    if (D->GetNumberField(TEXT("duck")) > .3) Pose += TEXT("+crouch");
    if (D->GetBoolField(TEXT("liveCombat"))) Pose += TEXT("+combat");
    return Pose.IsEmpty() ? TEXT("unknown") : Pose;
}
static void SampleAlignment(UWorld* World) {
    for (TActorIterator<ATVCharacter> It(World); It; ++It) {
        auto* V = It->FindComponentByClass<UTVCharacterPresentation>();
        if (!V || !V->HasVisibleCharacter() || !V->GetSkeletalMeshAsset()) continue;
        FAlign& A = Alignment.FindOrAdd(It->BodyId).FindOrAdd(PoseKey(*It));
        A.Samples++; A.Scale = V->GetComponentScale();
        TArray<USceneComponent*> Children; V->GetChildrenComponents(true, Children);
        for (auto* Child : Children) if (auto* Part = Cast<USkeletalMeshComponent>(Child); Part && Part->GetSkeletalMeshAsset() && Part->IsVisible()) {
            for (const TCHAR* Bone : AlignedBones) {
                if (Part->GetBoneIndex(Bone) == INDEX_NONE || V->GetBoneIndex(Bone) == INDEX_NONE) continue;
                const double Cm = FVector::Dist(Part->GetBoneLocation(Bone), V->GetBoneLocation(Bone));
                if (Cm > A.MaxCm) { A.MaxCm = Cm; A.Part = Part->GetSkeletalMeshAsset()->GetName(); A.Bone = Bone; }
            }
        }
    }
}
static TArray<TSharedPtr<FJsonValue>> AlignmentReport() {
    TArray<TSharedPtr<FJsonValue>> Rows;
    for (const auto& Person : Alignment) for (const auto& Pose : Person.Value) {
        auto Row = MakeShared<FJsonObject>();
        Row->SetStringField(TEXT("bodyId"), Person.Key); Row->SetStringField(TEXT("pose"), Pose.Key);
        Row->SetNumberField(TEXT("samples"), Pose.Value.Samples); Row->SetNumberField(TEXT("maxSeparationCm"), Pose.Value.MaxCm);
        Row->SetStringField(TEXT("worstPart"), Pose.Value.Part); Row->SetStringField(TEXT("worstBone"), Pose.Value.Bone);
        Row->SetArrayField(TEXT("visibleScale"), Vector(Pose.Value.Scale));
        Rows.Add(MakeShared<FJsonValueObject>(Row));
    }
    return Rows;
}

static TSharedPtr<FJsonObject> Parse(const FString& Text) {
    TSharedPtr<FJsonObject> Value;
    FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Value);
    return Value.IsValid() ? Value : MakeShared<FJsonObject>();
}
static TArray<TSharedPtr<FJsonValue>> Vector(const FVector& V) {
    return {MakeShared<FJsonValueNumber>(V.X), MakeShared<FJsonValueNumber>(V.Y), MakeShared<FJsonValueNumber>(V.Z)};
}
static void Finish(const FString& Error = FString()) {
    Report->SetStringField(TEXT("status"), Error.IsEmpty() ? TEXT("captured") : TEXT("failed"));
    Report->SetStringField(TEXT("error"), Error);
    Report->SetArrayField(TEXT("captures"), Captures);
    Report->SetArrayField(TEXT("partAlignment"), AlignmentReport());
    Report->SetNumberField(TEXT("elapsedSeconds"), FPlatformTime::Seconds() - Started);
    FString Text; FJsonSerializer::Serialize(Report.ToSharedRef(), TJsonWriterFactory<>::Create(&Text));
    FFileHelper::SaveStringToFile(Text, *(Directory / TEXT("capture.json")));
    UE_LOG(LogTemp, Display, TEXT("TV_ALPHA_CAPTURE status=%s error=%s out=%s"), Error.IsEmpty() ? TEXT("captured") : TEXT("failed"), *Error, *Directory);
    Running = false;
    FPlatformMisc::RequestExit(false);
}
static bool Tick(float) {
    if (!Running) return false;
    const double Now = FPlatformTime::Seconds();
    if (Now - Started > DeadlineSeconds) { Finish(TEXT("Timed out waiting for a ready world and completed render")); return false; }
    UWorld* World = nullptr;
    for (const FWorldContext& C : GEngine->GetWorldContexts()) if (C.WorldType == EWorldType::Game || C.WorldType == EWorldType::PIE) World = C.World();
    auto* Bridge = World ? World->GetSubsystem<UTVBridgeSubsystem>() : nullptr;
    auto* PC = World ? World->GetFirstPlayerController() : nullptr;
    // Once warm, include every frame, including streaming and stale-snapshot stalls.
    // Resetting this interval when assets load would cherry-pick the smooth periods.
    if (!Shot && ObserveAt > 0) {
        FrameDts.Add(Now - LastObservedFrame); LastObservedFrame = Now;
        if (IsAsyncLoading()) ++AsyncObservedFrames;
        if (!Bridge || !Bridge->IsLive() || Bridge->SinceSnapshot > 2) ++StaleObservedFrames;
        if (World && Now - AlignmentAt >= .5) { AlignmentAt = Now; SampleAlignment(World); }
    }
    Report->SetNumberField(TEXT("observedFrames"), GFrameCounter);
    Report->SetNumberField(TEXT("readyFrames"), Frames);
    Report->SetNumberField(TEXT("snapshotCount"), Bridge ? Bridge->SnapshotCount : 0);
    Report->SetNumberField(TEXT("snapshotAge"), Bridge ? Bridge->SinceSnapshot : 100);
    Report->SetNumberField(TEXT("regions"), Bridge ? Bridge->ProjectedRegions : 0);
    Report->SetBoolField(TEXT("asyncLoading"), IsAsyncLoading());
    if (!Bridge || !PC || !Bridge->IsLive() || Bridge->ProjectedRegions != 9 || Bridge->SnapshotCount < 10 || Bridge->SinceSnapshot > 2 || IsAsyncLoading()) { ReadyAt = 0; Frames = 0; return true; }
    if (!ReadyAt) ReadyAt = Now;
    if (++Frames < 90 || Now - ReadyAt < 5) return true;
    if (!Shot) {
        if (!ObserveAt) { ObserveAt = LastObservedFrame = Now; return true; }
        if (Now - ObserveAt < FMath::Max(5., ObserveSeconds)) return true;
    }
    if (!World->GetGameViewport() || World->GetGameViewport()->ViewModeIndex != VMI_Lit) { Finish(TEXT("No Lit game viewport")); return false; }
    if (Requested) {
        if (IFileManager::Get().FileSize(*ImagePath) <= 1000) return true;
        auto Frame = Parse(UTVPlayableLighting::RenderedFrameDiagnostics(ImagePath));
        Frame->SetStringField(TEXT("file"), ImagePath);
        Captures.Add(MakeShared<FJsonValueObject>(Frame));
        if (!Frame->GetBoolField(TEXT("passed"))) { Finish(TEXT("Rendered frame failed readability check")); return false; }
        Requested = false; ++Shot; ReadyAt = Now; Frames = 0;
        if (Shot >= MaxShots) { Finish(); return false; }
    }
    if (Now - ReadyAt < 5) return true;
    TArray<ATVCharacter*> Characters;
    for (TActorIterator<ATVCharacter> It(World); It; ++It) if (auto* V = It->FindComponentByClass<UTVCharacterPresentation>(); V && V->HasVisibleCharacter()) Characters.Add(*It);
    if (Characters.IsEmpty()) { Finish(TEXT("No resolved characters")); return false; }
    if (!Shot) {
        TArray<double> Sorted = FrameDts; Sorted.Sort();
        auto Timing = MakeShared<FJsonObject>();
        double Sum = 0; for (double Dt : Sorted) Sum += Dt;
        Timing->SetNumberField(TEXT("seconds"), Sum);
        Timing->SetNumberField(TEXT("frames"), Sorted.Num());
        Timing->SetNumberField(TEXT("asyncLoadingFrames"), AsyncObservedFrames);
        Timing->SetNumberField(TEXT("staleSnapshotFrames"), StaleObservedFrames);
        Timing->SetNumberField(TEXT("averageFPS"), Sum > 0 ? Sorted.Num() / Sum : 0);
        for (const auto& P : TArray<TPair<const TCHAR*, double>>{{TEXT("p50Ms"), .5}, {TEXT("p95Ms"), .95}, {TEXT("p99Ms"), .99}})
            Timing->SetNumberField(P.Key, Sorted.IsEmpty() ? 0 : 1000 * Sorted[FMath::Clamp(FMath::RoundToInt((Sorted.Num()-1)*P.Value), 0, Sorted.Num()-1)]);
        const FIntPoint Size = World->GetGameViewport()->Viewport->GetSizeXY();
        Timing->SetNumberField(TEXT("width"), Size.X); Timing->SetNumberField(TEXT("height"), Size.Y);
        Timing->SetStringField(TEXT("scope"), TEXT("ready live world, stationary native observer; no combat or physical-input acceptance"));
        Report->SetObjectField(TEXT("frameTiming"), Timing);
    }
    Characters.Sort([](const ATVCharacter& A, const ATVCharacter& B) { return A.BodyId < B.BodyId; });
    TArray<TSharedPtr<FJsonValue>> People;
    for (auto* Person : Characters) {
        auto* V = Person->FindComponentByClass<UTVCharacterPresentation>();
        auto Row = Parse(Person->PresentationDiagnostics());
        Row->SetObjectField(TEXT("embodiment"), Parse(V->EmbodimentDiagnostics()));
        Row->SetArrayField(TEXT("driverScale"), Vector(Person->GetMesh()->GetComponentScale()));
        Row->SetArrayField(TEXT("visibleScale"), Vector(V->GetComponentScale()));
        TArray<TSharedPtr<FJsonValue>> Parts;
        TArray<USceneComponent*> Children; V->GetChildrenComponents(true, Children); Children.Insert(V, 0);
        for (auto* Child : Children) if (auto* Mesh = Cast<USkeletalMeshComponent>(Child); Mesh && Mesh->GetSkeletalMeshAsset()) {
            auto Part = MakeShared<FJsonObject>(); Part->SetStringField(TEXT("mesh"), Mesh->GetSkeletalMeshAsset()->GetPathName());
            Part->SetArrayField(TEXT("worldScale"), Vector(Mesh->GetComponentScale()));
            Part->SetArrayField(TEXT("boundsExtent"), Vector(Mesh->Bounds.BoxExtent));
            Parts.Add(MakeShared<FJsonValueObject>(Part));
        }
        Row->SetArrayField(TEXT("parts"), Parts); People.Add(MakeShared<FJsonValueObject>(Row));
    }
    Report->SetArrayField(TEXT("people"), People);
    // Identify actual geometry/light bounds in a failed indoor view without moving the player.
    TArray<TSharedPtr<FJsonValue>> Surfaces, Lights;
    const FVector ViewEye=PC->PlayerCameraManager->GetCameraLocation();
    const FVector End=ViewEye+PC->PlayerCameraManager->GetCameraRotation().Vector()*1000;
    for(TActorIterator<ATVRegionProjection> It(World);It;++It) {
        TArray<UHierarchicalInstancedStaticMeshComponent*> Meshes; It->GetComponents(Meshes);
        for(auto* Mesh:Meshes) if(Mesh->GetStaticMesh()) for(int32 I=0;I<Mesh->GetInstanceCount();++I) {
            FTransform Transform; Mesh->GetInstanceTransform(I,Transform,true);
            const FBox Bounds=Mesh->GetStaticMesh()->GetBoundingBox().TransformBy(Transform);
            if(!FMath::LineBoxIntersection(Bounds,ViewEye,End,End-ViewEye)) continue;
            auto Row=MakeShared<FJsonObject>(); Row->SetStringField(TEXT("mesh"),Mesh->GetStaticMesh()->GetPathName());
            Row->SetStringField(TEXT("bounds"),Bounds.ToString());
            Row->SetBoolField(TEXT("containsCamera"),Bounds.IsInside(ViewEye));
            Surfaces.Add(MakeShared<FJsonValueObject>(Row));
        }
        TArray<UPointLightComponent*> Components; It->GetComponents(Components);
        for(auto* Light:Components) if(FVector::DistSquared(ViewEye,Light->GetComponentLocation())<FMath::Square(2000.)) {
            auto Row=MakeShared<FJsonObject>(); Row->SetStringField(TEXT("position"),Light->GetComponentLocation().ToString());
            Row->SetNumberField(TEXT("intensity"),Light->Intensity); Row->SetNumberField(TEXT("radius"),Light->AttenuationRadius);
            Row->SetBoolField(TEXT("visible"),Light->IsVisible()); Lights.Add(MakeShared<FJsonValueObject>(Row));
        }
    }
    Report->SetArrayField(TEXT("cameraRayBounds"),Surfaces); Report->SetArrayField(TEXT("nearbyLights"),Lights);
    Report->SetStringField(TEXT("map"), World->GetMapName());
    Report->SetStringField(TEXT("worldId"), Bridge->WorldId);
    Report->SetStringField(TEXT("serverRelease"), Bridge->ServerRelease);
    Report->SetNumberField(TEXT("regions"), Bridge->ProjectedRegions);
    Report->SetStringField(TEXT("lightingError"), UTVPlayableLighting::ValidateDaylight(World, true));
    if (Shot > 0) {
        auto* Subject = Characters[(Shot - 1) % Characters.Num()];
        const FVector Target = Subject->GetActorLocation() + FVector(0, 0, 20);
        const FVector Eye = Target + Subject->GetActorForwardVector() * 300 + Subject->GetActorRightVector() * 110 + FVector(0, 0, 35);
        if (!Camera.IsValid()) Camera = World->SpawnActor<ACameraActor>();
        Camera->SetActorLocationAndRotation(Eye, (Target - Eye).Rotation());
        Camera->GetCameraComponent()->SetFieldOfView(48);
        PC->SetViewTarget(Camera.Get());
        // Capture on a later tick so this camera and the current animated pose have rendered.
        if (ShotAt == 0) { ShotAt = Now; return true; }
        if (Now - ShotAt < 2) return true;
    }
    ShotAt = 0;
    ImagePath = Directory / FString::Printf(TEXT("frame-%02d.png"), Shot);
    FScreenshotRequest::RequestScreenshot(ImagePath, false, false);
    Requested = true;
    return true;
}
static void Start() {
    if (Running) return;
    Directory = FPlatformMisc::GetEnvironmentVariable(TEXT("TV_ALPHA_CAPTURE_DIR"));
    if (Directory.IsEmpty()) { UE_LOG(LogTemp, Error, TEXT("TV_ALPHA_CAPTURE_DIR is required")); return; }
    MaxShots = FMath::Clamp(FCString::Atoi(*FPlatformMisc::GetEnvironmentVariable(TEXT("TV_ALPHA_CAPTURE_SHOTS"))), 1, 5);
    const double Budget = FCString::Atod(*FPlatformMisc::GetEnvironmentVariable(TEXT("TV_ALPHA_CAPTURE_TIMEOUT")));
    DeadlineSeconds = Budget > 0 ? FMath::Clamp(Budget, 15., 570.) : 110.;
    ObserveSeconds = FMath::Clamp(FCString::Atod(*FPlatformMisc::GetEnvironmentVariable(TEXT("TV_ALPHA_CAPTURE_OBSERVE_SECONDS"))), 0., 300.);
    ObserveAt = LastObservedFrame = 0; AsyncObservedFrames = StaleObservedFrames = 0; FrameDts.Reset(); Alignment.Reset(); AlignmentAt = 0;
    IFileManager::Get().MakeDirectory(*Directory, true);
    Report = MakeShared<FJsonObject>(); Report->SetStringField(TEXT("kind"), TEXT("native rendered observation; no player input"));
    Captures.Reset(); Camera.Reset(); Running = true; Requested = false; Started = FPlatformTime::Seconds(); ReadyAt = ShotAt = 0; Shot = Frames = 0;
    FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&Tick));
}
static FAutoConsoleCommand Command(TEXT("TV.AlphaCapture"), TEXT("Bounded read-only Living Alpha render capture, then exit"), FConsoleCommandDelegate::CreateStatic(&Start));
}
#endif
