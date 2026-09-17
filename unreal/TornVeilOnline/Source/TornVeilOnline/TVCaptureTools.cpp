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

    FAutoConsoleCommand RecordCommand(TEXT("TV.Record"), TEXT("Editor evidence: TV.Record <folder> [seconds] | TV.Record stop. Reads the PIE back buffer only."), FConsoleCommandWithArgsDelegate::CreateStatic(&StartRecording));
    FAutoConsoleCommand DebugViewCommand(TEXT("TV.DebugView"), TEXT("Editor diagnostics: TV.DebugView eyeX eyeH eyeZ targetX targetH targetZ [fov] in canonical metres; no args restores the pawn view."), FConsoleCommandWithArgsDelegate::CreateStatic(&DebugView));
    FAutoConsoleCommand TestKeyCommand(TEXT("TV.TestKey"), TEXT("Editor acceptance: TV.TestKey <key> [seconds]. Ordinary PlayerController input only."), FConsoleCommandWithArgsDelegate::CreateStatic(&TestKey));
    FAutoConsoleCommand TestTurnCommand(TEXT("TV.TestTurn"), TEXT("Editor acceptance: TV.TestTurn <mouse units/second> <seconds>."), FConsoleCommandWithArgsDelegate::CreateStatic(&TestTurn));
}
#endif
