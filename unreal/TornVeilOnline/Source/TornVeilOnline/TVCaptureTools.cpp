// Editor-only evidence tooling for ordinary PIE. Nothing here edits canonical state:
// recording reads the rendered back buffer, DebugView swaps only the local view target,
// and TestKey/TestTurn dispatch ordinary PlayerController input through configured bindings.
#if WITH_EDITOR
#include "CoreMinimal.h"
#include "HAL/IConsoleManager.h"
#include "Editor.h"
#include "IAssetViewport.h"
#include "Slate/SceneViewport.h"
#include "FrameGrabber.h"
#include "IImageWrapperModule.h"
#include "IImageWrapper.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "HAL/FileManager.h"
#include "Async/Async.h"
#include "Containers/Ticker.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/Pawn.h"
#include "InputKeyEventArgs.h"
#include "Editor/EditorPerformanceSettings.h"
#include "TVWorldProjection.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/StaticMesh.h"
#include "Engine/NaniteAssemblyData.h"
#include "FileHelpers.h"
#include "StaticMeshAttributes.h"
#include "StaticMeshOperations.h"
#include "MeshDescription.h"
#include "Animation/SkeletalMeshActor.h"
#include "Engine/StaticMeshActor.h"
#include "Components/StaticMeshComponent.h"
#include "Components/SkeletalMeshComponent.h"

namespace
{
    struct FTVFramePayload : IFramePayload { double Seconds = 0; };

    struct FTVRecorder
    {
        TUniquePtr<FFrameGrabber> Grabber;
        FString Folder;
        double Started = 0, Duration = 0;
        int32 Written = 0;
        TArray<double> Times;
        FTSTicker::FDelegateHandle Ticker;
        TAtomic<int32> Pending{0};
        bool bThrottleWas = true;
    };
    FTVRecorder Recorder;
    // The JPEG encoder corrupts macroblocks when frames compress concurrently; keep one at a time.
    FCriticalSection JpegLock;
    TWeakObjectPtr<ACameraActor> DebugCamera;

    UWorld* PIEWorld()
    {
        UWorld* World = nullptr;
        for (const FWorldContext& Context : GEngine->GetWorldContexts()) if (Context.WorldType == EWorldType::PIE) World = Context.World();
        return World;
    }

    TSharedPtr<FSceneViewport> PIEViewport()
    {
        if (!GEditor) return nullptr;
        for (auto& Pair : GEditor->SlatePlayInEditorMap) {
            if (TSharedPtr<IAssetViewport> Viewport = Pair.Value.DestinationSlateViewport.Pin()) return Viewport->GetSharedActiveViewport();
            if (Pair.Value.SlatePlayInEditorWindowViewport) return Pair.Value.SlatePlayInEditorWindowViewport;
        }
        return nullptr;
    }

    void Drain(bool bFinal)
    {
        if (!Recorder.Grabber) return;
        for (FCapturedFrameData& Frame : Recorder.Grabber->GetCapturedFrames()) {
            const int32 Index = Recorder.Written++;
            Recorder.Times.Add(Frame.GetPayload<FTVFramePayload>()->Seconds);
            const FString Path = FString::Printf(TEXT("%s/frame-%05d.jpg"), *Recorder.Folder, Index);
            ++Recorder.Pending;
            Async(EAsyncExecution::ThreadPool, [Colors = MoveTemp(Frame.ColorBuffer), Size = Frame.BufferSize, Path]() mutable {
                FScopeLock Lock(&JpegLock);
                IImageWrapperModule& Module = FModuleManager::LoadModuleChecked<IImageWrapperModule>(TEXT("ImageWrapper"));
                TSharedPtr<IImageWrapper> Jpeg = Module.CreateImageWrapper(EImageFormat::JPEG);
                for (FColor& C : Colors) C.A = 255;
                if (Jpeg && Jpeg->SetRaw(Colors.GetData(), Colors.Num() * sizeof(FColor), Size.X, Size.Y, ERGBFormat::BGRA, 8))
                    FFileHelper::SaveArrayToFile(Jpeg->GetCompressed(90), *Path);
                --Recorder.Pending;
            });
        }
        if (!bFinal) return;
        while (Recorder.Pending > 0) FPlatformProcess::Sleep(0.01f);
        FString Manifest = TEXT("ffconcat version 1.0\n");
        for (int32 I = 0; I < Recorder.Times.Num(); ++I) {
            const double Next = Recorder.Times.IsValidIndex(I + 1) ? Recorder.Times[I + 1] : Recorder.Times[I] + 1.0 / 60.0;
            Manifest += FString::Printf(TEXT("file 'frame-%05d.jpg'\nduration %.5f\n"), I, FMath::Max(0.001, Next - Recorder.Times[I]));
        }
        FFileHelper::SaveStringToFile(Manifest, *(Recorder.Folder / TEXT("frames.ffconcat")));
        const double Seconds = Recorder.Times.Num() > 1 ? Recorder.Times.Last() - Recorder.Times[0] : 0;
        UE_LOG(LogTemp, Display, TEXT("TV_RECORD_DONE folder=%s frames=%d seconds=%.2f fps=%.2f"), *Recorder.Folder, Recorder.Times.Num(), Seconds, Seconds > 0 ? (Recorder.Times.Num() - 1) / Seconds : 0);
    }

    void StopRecording()
    {
        if (!Recorder.Grabber) return;
        FTSTicker::GetCoreTicker().RemoveTicker(Recorder.Ticker);
        Recorder.Grabber->StopCapturingFrames();
        // Allow in-flight surfaces to resolve before the grabber is destroyed.
        for (int32 Attempt = 0; Attempt < 20 && Recorder.Grabber->HasOutstandingFrames(); ++Attempt) { FlushRenderingCommands(); Drain(false); }
        Drain(true);
        Recorder.Grabber->Shutdown();
        Recorder.Grabber.Reset();
        GetMutableDefault<UEditorPerformanceSettings>()->bThrottleCPUWhenNotForeground = Recorder.bThrottleWas;
    }

    void StartRecording(const TArray<FString>& Args)
    {
        if (Args.Num() && Args[0] == TEXT("stop")) { StopRecording(); return; }
        if (Recorder.Grabber || Args.Num() < 1) return;
        TSharedPtr<FSceneViewport> Viewport = PIEViewport();
        if (!Viewport) { UE_LOG(LogTemp, Error, TEXT("TV_RECORD requires a PIE viewport")); return; }
        Recorder.Folder = FPaths::ConvertRelativePathToFull(Args[0]);
        IFileManager::Get().MakeDirectory(*Recorder.Folder, true);
        Recorder.Duration = Args.Num() > 1 ? FMath::Clamp(FCString::Atod(*Args[1]), 1.0, 180.0) : 30.0;
        Recorder.Written = 0; Recorder.Times.Reset();
        // An occluded or unfocused editor must keep rendering at its ordinary rate while recording.
        Recorder.bThrottleWas = GetDefault<UEditorPerformanceSettings>()->bThrottleCPUWhenNotForeground;
        GetMutableDefault<UEditorPerformanceSettings>()->bThrottleCPUWhenNotForeground = false;
        // Capture at the resolved viewport size; resampling is left to the offline encoder.
        const FIntPoint Size = Viewport->GetSize();
        Recorder.Grabber = MakeUnique<FFrameGrabber>(Viewport.ToSharedRef(), Size, PF_B8G8R8A8, 3);
        Recorder.Grabber->StartCapturingFrames();
        Recorder.Started = FPlatformTime::Seconds();
        Recorder.Ticker = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([](float) {
            if (!Recorder.Grabber) return false;
            const double Age = FPlatformTime::Seconds() - Recorder.Started;
            if (Age >= Recorder.Duration || !PIEWorld()) { AsyncTask(ENamedThreads::GameThread, [] { StopRecording(); }); return false; }
            auto Payload = MakeShared<FTVFramePayload, ESPMode::ThreadSafe>(); Payload->Seconds = Age;
            Recorder.Grabber->CaptureThisFrame(Payload);
            Drain(false);
            return true;
        }));
        UE_LOG(LogTemp, Display, TEXT("TV_RECORD_START folder=%s size=%dx%d seconds=%.1f"), *Recorder.Folder, Size.X, Size.Y, Recorder.Duration);
    }

    /** Canonical metres (x, height, z) to the streamed presentation frame. */
    bool CanonicalToWorld(UWorld* World, double X, double H, double Z, FVector& Out)
    {
        for (TActorIterator<ATVRegionProjection> It(World); It; ++It) {
            Out = It->GetActorLocation() + FVector(X - It->CanonicalBase.X, Z - It->CanonicalBase.Y, 0) * 100 + FVector(0, 0, H * 100);
            return true;
        }
        return false;
    }

    void DebugView(const TArray<FString>& Args)
    {
        UWorld* World = PIEWorld(); if (!World || !World->GetFirstPlayerController()) return;
        APlayerController* PC = World->GetFirstPlayerController();
        if (Args.Num() < 6) {
            if (DebugCamera.IsValid()) DebugCamera->Destroy();
            PC->SetViewTargetWithBlend(PC->GetPawn(), 0);
            UE_LOG(LogTemp, Display, TEXT("TV_DEBUG_VIEW off"));
            return;
        }
        FVector Eye, Target;
        if (!CanonicalToWorld(World, FCString::Atod(*Args[0]), FCString::Atod(*Args[1]), FCString::Atod(*Args[2]), Eye)) return;
        CanonicalToWorld(World, FCString::Atod(*Args[3]), FCString::Atod(*Args[4]), FCString::Atod(*Args[5]), Target);
        if (!DebugCamera.IsValid()) {
            FActorSpawnParameters Params; Params.ObjectFlags |= RF_Transient;
            DebugCamera = World->SpawnActor<ACameraActor>(Eye, FRotator::ZeroRotator, Params);
            DebugCamera->GetCameraComponent()->bConstrainAspectRatio = false;
        }
        DebugCamera->GetCameraComponent()->SetFieldOfView(Args.Num() > 6 ? FCString::Atof(*Args[6]) : 75.f);
        DebugCamera->SetActorLocationAndRotation(Eye, (Target - Eye).Rotation());
        PC->SetViewTargetWithBlend(DebugCamera.Get(), 0);
    }

    void SendKey(APlayerController* PC, const FKey& Key, EInputEvent Event, float Value)
    {
        PC->InputKey(FInputKeyEventArgs(nullptr, IPlatformInputDeviceMapper::Get().GetDefaultInputDevice(), Key, Event, Value, false, FPlatformTime::Cycles64()));
    }

    void TestKey(const TArray<FString>& Args)
    {
        UWorld* World = PIEWorld(); if (Args.Num() < 1 || !World || !World->GetFirstPlayerController()) return;
        APlayerController* PC = World->GetFirstPlayerController(); const FKey Key(*Args[0]);
        if (!Key.IsValid() || Key.IsAxis1D()) return;
        const float Seconds = FMath::Clamp(Args.Num() > 1 ? FCString::Atof(*Args[1]) : .15f, .05f, 8.f);
        SendKey(PC, Key, IE_Pressed, 1);
        UE_LOG(LogTemp, Display, TEXT("TV_TEST_KEY %s pressed seconds=%.2f"), *Key.ToString(), Seconds);
        FTimerHandle Timer;
        World->GetTimerManager().SetTimer(Timer, FTimerDelegate::CreateWeakLambda(PC, [PC, Key] { SendKey(PC, Key, IE_Released, 0); }), Seconds, false);
    }

    /** TV.TestTurn <mouse units per second> <seconds>: ordinary MouseX axis events each frame. */
    void TestTurn(const TArray<FString>& Args)
    {
        UWorld* World = PIEWorld(); if (Args.Num() < 2 || !World || !World->GetFirstPlayerController()) return;
        TWeakObjectPtr<APlayerController> PC = World->GetFirstPlayerController();
        const float Rate = FCString::Atof(*Args[0]); const double End = FPlatformTime::Seconds() + FMath::Clamp(FCString::Atof(*Args[1]), .05f, 8.f);
        FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([PC, Rate, End](float Delta) {
            if (!PC.IsValid() || FPlatformTime::Seconds() > End) return false;
            SendKey(PC.Get(), EKeys::MouseX, IE_Axis, Rate * Delta);
            return true;
        }));
    }

    /** TV.BakeNaniteAssembly <skeletal object path> <static object path>
     * Local derived-asset tooling: copies a skeletal vegetation mesh's Nanite assembly (branch and
     * leaf part instances) onto an already-derived static mesh, resolving bone-relative nodes in the
     * reference pose. Source packages are read only; the derived static mesh stays git-ignored. */
    void BakeNaniteAssembly(const TArray<FString>& Args)
    {
        if (Args.Num() < 2 || PIEWorld()) { UE_LOG(LogTemp, Error, TEXT("TV_BAKE requires two object paths and no PIE")); return; }
        USkeletalMesh* Skeletal = LoadObject<USkeletalMesh>(nullptr, *Args[0]);
        UStaticMesh* Static = LoadObject<UStaticMesh>(nullptr, *Args[1]);
        if (!Skeletal || !Static) { UE_LOG(LogTemp, Error, TEXT("TV_BAKE missing mesh %s or %s"), *Args[0], *Args[1]); return; }
        FMeshNaniteSettings Source = Skeletal->GetNaniteSettings();
        if (!Source.NaniteAssemblyData.IsValid()) { UE_LOG(LogTemp, Error, TEXT("TV_BAKE %s has no Nanite assembly"), *Args[0]); return; }
        const FReferenceSkeleton& Reference = Skeletal->GetRefSkeleton();
        TArray<FTransform> ComponentSpace; ComponentSpace.SetNum(Reference.GetRawBoneNum());
        for (int32 Bone = 0; Bone < ComponentSpace.Num(); ++Bone) {
            const int32 Parent = Reference.GetRawParentIndex(Bone);
            ComponentSpace[Bone] = Parent == INDEX_NONE ? Reference.GetRawRefBonePose()[Bone] : Reference.GetRawRefBonePose()[Bone] * ComponentSpace[Parent];
        }
        int32 Resolved = 0;
        for (FNaniteAssemblyNode& Node : Source.NaniteAssemblyData.Nodes) {
            if (Node.TransformSpace == ENaniteAssemblyNodeTransformSpace::BoneRelative && Node.BoneInfluences.Num()) {
                const FNaniteAssemblyBoneInfluence* Strongest = &Node.BoneInfluences[0];
                for (const auto& Influence : Node.BoneInfluences) if (Influence.BoneWeight > Strongest->BoneWeight) Strongest = &Influence;
                if (ComponentSpace.IsValidIndex(Strongest->BoneIndex)) {
                    const FTransform Local = FTransform(Node.Transform) * ComponentSpace[Strongest->BoneIndex];
                    Node.Transform = FTransform3f(Local); ++Resolved;
                }
            }
            Node.TransformSpace = ENaniteAssemblyNodeTransformSpace::Local;
            Node.BoneInfluences.Reset();
        }
        // Skeletal assemblies instance skeletal parts; a static assembly needs static parts. Prefer the
        // library's own static twin (SKM_Name -> Name), then a locally derived conversion.
        TArray<FString> Unresolved;
        for (FNaniteAssemblyPart& Part : Source.NaniteAssemblyData.Parts) {
            const FString PackagePath = FPackageName::GetLongPackagePath(Part.MeshObjectPath.GetLongPackageName());
            FString Name = FPackageName::GetShortName(Part.MeshObjectPath.GetLongPackageName());
            if (LoadObject<UStaticMesh>(nullptr, *Part.MeshObjectPath.ToString())) continue;
            if (Name.StartsWith(TEXT("SKM_"))) Name.RightChopInline(4);
            const TArray<FString> Candidates = { PackagePath / Name + TEXT(".") + Name, TEXT("/Game/TornVeil/LocalPalette/Vegetation/Parts/") + Name + TEXT(".") + Name };
            bool bFound = false;
            for (const FString& Candidate : Candidates) if (LoadObject<UStaticMesh>(nullptr, *Candidate)) { Part.MeshObjectPath = FSoftObjectPath(Candidate); bFound = true; break; }
            if (!bFound) Unresolved.Add(Part.MeshObjectPath.ToString());
        }
        for (const FString& Missing : Unresolved) UE_LOG(LogTemp, Warning, TEXT("TV_BAKE_UNRESOLVED %s"), *Missing);
        FMeshNaniteSettings Target = Source;
        Target.bEnabled = true;
        Static->Modify();
        Static->SetNaniteSettings(Target);
        Static->PostEditChange();
        UEditorLoadingAndSavingUtils::SavePackages({Static->GetPackage()}, false);
        UE_LOG(LogTemp, Display, TEXT("TV_BAKE %s parts=%d nodes=%d boneResolved=%d"), *Args[1], Target.NaniteAssemblyData.Parts.Num(), Target.NaniteAssemblyData.Nodes.Num(), Resolved);
    }

    /** Recursively resolves a mesh's Nanite assembly into (static part, mesh-space transform) leaves. */
    void CollectAssemblyLeaves(const FNaniteAssemblyData& Data, const FTransform& Parent, int32 Depth, TArray<TPair<UStaticMesh*, FTransform>>& Out, TArray<FString>& Missing)
    {
        for (const FNaniteAssemblyNode& Node : Data.Nodes) {
            if (!Data.Parts.IsValidIndex(Node.PartIndex)) continue;
            const FSoftObjectPath& Path = Data.Parts[Node.PartIndex].MeshObjectPath;
            UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, *Path.ToString());
            if (!Mesh) {
                FString Name = FPackageName::GetShortName(Path.GetLongPackageName());
                if (Name.StartsWith(TEXT("SKM_"))) Name.RightChopInline(4);
                Mesh = LoadObject<UStaticMesh>(nullptr, *(FPackageName::GetLongPackagePath(Path.GetLongPackageName()) / Name + TEXT(".") + Name));
            }
            if (!Mesh) { Missing.AddUnique(Path.ToString()); continue; }
            const FTransform World = FTransform(Node.Transform) * Parent;
            Out.Add({Mesh, World});
            if (Depth < 4 && Mesh->GetNaniteSettings().NaniteAssemblyData.IsValid()) CollectAssemblyLeaves(Mesh->GetNaniteSettings().NaniteAssemblyData, World, Depth + 1, Out, Missing);
        }
    }

    /** TV.FlattenVegetation <skeletal> <static> [dry]: appends every assembly part's own geometry
     * into the derived static mesh so instanced Nanite renders full canopies without assemblies. */
    void FlattenVegetation(const TArray<FString>& Args)
    {
        if (Args.Num() < 2 || PIEWorld()) return;
        USkeletalMesh* Skeletal = LoadObject<USkeletalMesh>(nullptr, *Args[0]);
        UStaticMesh* Static = LoadObject<UStaticMesh>(nullptr, *Args[1]);
        if (!Skeletal || !Static) { UE_LOG(LogTemp, Error, TEXT("TV_FLATTEN missing mesh")); return; }
        const bool bDry = Args.Num() > 2 && Args[2] == TEXT("dry");
        TArray<TPair<UStaticMesh*, FTransform>> Leaves; TArray<FString> Missing;
        CollectAssemblyLeaves(Skeletal->GetNaniteSettings().NaniteAssemblyData, FTransform::Identity, 0, Leaves, Missing);
        int64 Triangles = 0; TMap<UStaticMesh*, int32> Uses;
        for (const auto& Leaf : Leaves) { Uses.FindOrAdd(Leaf.Key)++; if (const FMeshDescription* D = Leaf.Key->GetMeshDescription(0)) Triangles += D->Triangles().Num(); }
        UE_LOG(LogTemp, Display, TEXT("TV_FLATTEN %s leaves=%d distinctParts=%d triangles=%lld missing=%d"), *Args[1], Leaves.Num(), Uses.Num(), Triangles, Missing.Num());
        for (const auto& Pair : Uses) UE_LOG(LogTemp, Display, TEXT("TV_FLATTEN_PART %s uses=%d tris=%d assembly=%d"), *Pair.Key->GetPathName(), Pair.Value, Pair.Key->GetMeshDescription(0) ? Pair.Key->GetMeshDescription(0)->Triangles().Num() : -1, Pair.Key->GetNaniteSettings().NaniteAssemblyData.IsValid() ? 1 : 0);
        for (const FString& Path : Missing) UE_LOG(LogTemp, Warning, TEXT("TV_FLATTEN_MISSING %s"), *Path);
        if (bDry || Triangles > 12000000) return;

        FMeshDescription* Target = Static->GetMeshDescription(0);
        if (!Target) return;
        // Material slots on the derived mesh follow the skeletal source list; parts map by slot name.
        TMap<FName, int32> SlotByName;
        for (int32 I = 0; I < Static->GetStaticMaterials().Num(); ++I) SlotByName.Add(Static->GetStaticMaterials()[I].ImportedMaterialSlotName, I);
        FStaticMeshAttributes TargetAttributes(*Target);
        for (const auto& Leaf : Leaves) {
            const FMeshDescription* Source = Leaf.Key->GetMeshDescription(0); if (!Source) continue;
            FStaticMeshConstAttributes SourceAttributes(*Source);
            FStaticMeshOperations::FAppendSettings Settings;
            Settings.MeshTransform = Leaf.Value;
            Settings.PolygonGroupsDelegate = FAppendPolygonGroupsDelegate::CreateLambda([&, Mesh = Leaf.Key](const FMeshDescription& From, FMeshDescription& To, PolygonGroupMap& Remap) {
                FStaticMeshConstAttributes FromAttributes(From); FStaticMeshAttributes ToAttributes(To);
                const auto FromNames = FromAttributes.GetPolygonGroupMaterialSlotNames();
                auto ToNames = ToAttributes.GetPolygonGroupMaterialSlotNames();
                for (const FPolygonGroupID Group : From.PolygonGroups().GetElementIDs()) {
                    // Parts share the parent's Bark/Foliage materials; match their material to an existing group.
                    const UMaterialInterface* PartMaterial = Mesh->GetStaticMaterials().IsValidIndex(Group.GetValue()) ? Mesh->GetStaticMaterials()[Group.GetValue()].MaterialInterface.Get() : nullptr;
                    int32 Slot = INDEX_NONE;
                    for (int32 I = 0; I < Static->GetStaticMaterials().Num(); ++I) if (Static->GetStaticMaterials()[I].MaterialInterface == PartMaterial) { Slot = I; break; }
                    if (Slot == INDEX_NONE) { const FName Name = FromNames[Group]; Slot = SlotByName.Contains(Name) ? SlotByName[Name] : Static->GetStaticMaterials().Num() - 1; }
                    FPolygonGroupID Existing = INDEX_NONE;
                    for (const FPolygonGroupID ToGroup : To.PolygonGroups().GetElementIDs()) if (ToGroup.GetValue() == Slot) { Existing = ToGroup; break; }
                    if (Existing == INDEX_NONE) { Existing = To.CreatePolygonGroup(); ToNames[Existing] = Static->GetStaticMaterials()[FMath::Max(Slot, 0)].ImportedMaterialSlotName; }
                    Remap.Add(Group, Existing);
                }
            });
            FStaticMeshOperations::AppendMeshDescription(*Source, *Target, Settings);
        }
        FMeshNaniteSettings Nanite = Static->GetNaniteSettings();
        Nanite.NaniteAssemblyData = FNaniteAssemblyData();
        Nanite.bEnabled = true;
        Nanite.ShapePreservation = Skeletal->GetNaniteSettings().ShapePreservation;
        Static->Modify();
        Static->SetNaniteSettings(Nanite);
        Static->CommitMeshDescription(0);
        Static->Build(false);
        Static->PostEditChange();
        UEditorLoadingAndSavingUtils::SavePackages({Static->GetPackage()}, false);
        UE_LOG(LogTemp, Display, TEXT("TV_FLATTEN_DONE %s triangles=%d"), *Args[1], Target->Triangles().Num());
    }

    /** TV.PreviewMesh <object path> x h z: transient diagnostic mesh in PIE at canonical metres. */
    void PreviewMesh(const TArray<FString>& Args)
    {
        UWorld* World = PIEWorld(); FVector At;
        if (!World || Args.Num() < 4 || !CanonicalToWorld(World, FCString::Atod(*Args[1]), FCString::Atod(*Args[2]), FCString::Atod(*Args[3]), At)) return;
        FActorSpawnParameters Params; Params.ObjectFlags |= RF_Transient;
        if (USkeletalMesh* Skeletal = LoadObject<USkeletalMesh>(nullptr, *Args[0])) {
            auto* Actor = World->SpawnActor<ASkeletalMeshActor>(At, FRotator::ZeroRotator, Params);
            Actor->GetSkeletalMeshComponent()->SetSkeletalMesh(Skeletal);
        } else if (UStaticMesh* Static = LoadObject<UStaticMesh>(nullptr, *Args[0])) {
            auto* Actor = World->SpawnActor<AStaticMeshActor>(At, FRotator::ZeroRotator, Params);
            Actor->SetMobility(EComponentMobility::Movable); Actor->GetStaticMeshComponent()->SetStaticMesh(Static);
        }
        UE_LOG(LogTemp, Display, TEXT("TV_PREVIEW_MESH %s"), *Args[0]);
    }
    FAutoConsoleCommand PreviewCommand(TEXT("TV.PreviewMesh"), TEXT("Editor diagnostics: TV.PreviewMesh <object path> x h z."), FConsoleCommandWithArgsDelegate::CreateStatic(&PreviewMesh));

    FAutoConsoleCommand FlattenCommand(TEXT("TV.FlattenVegetation"), TEXT("Editor asset tooling: TV.FlattenVegetation <skeletal> <static> [dry]."), FConsoleCommandWithArgsDelegate::CreateStatic(&FlattenVegetation));
    FAutoConsoleCommand BakeCommand(TEXT("TV.BakeNaniteAssembly"), TEXT("Editor asset tooling: TV.BakeNaniteAssembly <skeletal> <static>."), FConsoleCommandWithArgsDelegate::CreateStatic(&BakeNaniteAssembly));
    FAutoConsoleCommand RecordCommand(TEXT("TV.Record"), TEXT("Editor evidence: TV.Record <folder> [seconds] | TV.Record stop. Reads the PIE back buffer only."), FConsoleCommandWithArgsDelegate::CreateStatic(&StartRecording));
    FAutoConsoleCommand DebugViewCommand(TEXT("TV.DebugView"), TEXT("Editor diagnostics: TV.DebugView eyeX eyeH eyeZ targetX targetH targetZ [fov] in canonical metres; no args restores the pawn view."), FConsoleCommandWithArgsDelegate::CreateStatic(&DebugView));
    FAutoConsoleCommand TestKeyCommand(TEXT("TV.TestKey"), TEXT("Editor acceptance: TV.TestKey <key> [seconds]. Ordinary PlayerController input only."), FConsoleCommandWithArgsDelegate::CreateStatic(&TestKey));
    FAutoConsoleCommand TestTurnCommand(TEXT("TV.TestTurn"), TEXT("Editor acceptance: TV.TestTurn <mouse units/second> <seconds>."), FConsoleCommandWithArgsDelegate::CreateStatic(&TestTurn));
}
#endif
