#include "CoreMinimal.h"

#if WITH_DEV_AUTOMATION_TESTS

#include "TVBridgeSubsystem.h"
#include "TVCharacter.h"
#include "Engine/Engine.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformFileManager.h"
#include "GenericPlatform/GenericPlatformInputDeviceMapper.h"
#include "InputKeyEventArgs.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Containers/Array.h"
#include "Containers/Ticker.h"
#include "Misc/Parse.h"
#include "HAL/PlatformMisc.h"
#include "InputCoreTypes.h"

namespace TVRealtimeProbe {
struct FSample { double At = 0; FVector Position = FVector::ZeroVector; double Dt = 0; };
struct FDispatch { double At = 0; FString Key; FString State; };
static bool bRunning = false;
static FTSTicker::FDelegateHandle TickHandle;
static double StartedAt = 0;
static int32 Bout = 0;
static bool bPressedW = false, bPressedShift = false, bSprintBout = false;
static double StateAt = 0;
static double LastAt = 0;
static double LastReleaseAt = 0;
static TWeakObjectPtr<UWorld> ProbeWorld;
static TWeakObjectPtr<ATVCharacter> ProbePlayer;
static TArray<FSample> Samples;
static TArray<FDispatch> Dispatches;

static FString Path() { return FPaths::ProjectDir() / TEXT("../../docs/evidence/realtime/native-standalone.json"); }
static FString JsonEscape(const FString& In) { return In.Replace(TEXT("\\"), TEXT("\\\\")).Replace(TEXT("\""), TEXT("\\\"")).Replace(TEXT("\r"), TEXT("\\r")).Replace(TEXT("\n"), TEXT("\\n")); }
static void Key(UWorld* World, const FKey& K, EInputEvent Event, const TCHAR* State) {
    if (!World || !World->GetFirstPlayerController()) return;
    auto* PC = World->GetFirstPlayerController();
    PC->InputKey(FInputKeyEventArgs(nullptr, IPlatformInputDeviceMapper::Get().GetDefaultInputDevice(), K, Event, Event == IE_Pressed ? 1.f : 0.f, false, FPlatformTime::Cycles64()));
    FDispatch D; D.At = FPlatformTime::Seconds() - StartedAt; D.Key = K.ToString(); D.State = State; Dispatches.Add(MoveTemp(D));
}
static void Write(FString Status, const FString& Error = FString()) {
    if (bPressedW || bPressedShift) {
        if (UWorld* World = ProbeWorld.Get()) {
            if (bPressedW) Key(World, EKeys::W, IE_Released, TEXT("released-failure"));
            if (bPressedShift) Key(World, EKeys::LeftShift, IE_Released, TEXT("released-failure"));
        }
        bPressedW = bPressedShift = false;
    }
    TArray<double> Dts; for (const auto& S : Samples) if (S.Dt > .001) Dts.Add(S.Dt); Dts.Sort();
    const auto Percentile = [&Dts](double P) { return Dts.Num() ? Dts[FMath::Clamp(FMath::RoundToInt((Dts.Num()-1)*P), 0, Dts.Num()-1)] : 0.; };
    double Travel = 0; for (int32 I=1; I<Samples.Num(); ++I) Travel += FVector::Dist(Samples[I-1].Position, Samples[I].Position);
    double Tail = 0; int32 ReleasedTailSamples = 0; const double TailAt = LastReleaseAt - StartedAt + .1; for (int32 I=1; I<Samples.Num(); ++I) if (Samples[I].At >= TailAt) { ++ReleasedTailSamples; Tail = FMath::Max(Tail, FVector::Dist(Samples[I-1].Position, Samples[I].Position)); }
    const bool Moved = Travel > 1.; const bool Stopped = ReleasedTailSamples >= 8 && Tail <= .1;
    FString FinalDiagnostics = TEXT("{}");
    if (UTVBridgeSubsystem* B = ProbeWorld.IsValid() ? ProbeWorld->GetSubsystem<UTVBridgeSubsystem>() : nullptr) FinalDiagnostics = B->RealtimeDiagnostics();
    FString Json = FString::Printf(TEXT("{\"status\":\"%s\",\"passed\":%s,\"error\":\"%s\",\"sampleCount\":%d,\"dispatchCount\":%d,\"moved\":%s,\"travelCm\":%.4f,\"stoppedTail\":%s,\"frameDtSeconds\":{\"p50\":%.6f,\"p95\":%.6f,\"p99\":%.6f,\"count\":%d},\"dispatches\":["), *Status, (Moved && Stopped && Error.IsEmpty()) ? TEXT("true") : TEXT("false"), *JsonEscape(Error), Samples.Num(), Dispatches.Num(), Moved ? TEXT("true") : TEXT("false"), Travel, Stopped ? TEXT("true") : TEXT("false"), Percentile(.5), Percentile(.95), Percentile(.99), Dts.Num());
    for (int32 I=0; I<Dispatches.Num(); ++I) { if (I) Json += TEXT(","); Json += FString::Printf(TEXT("{\"at\":%.4f,\"key\":\"%s\",\"state\":\"%s\"}"), Dispatches[I].At, *Dispatches[I].Key, *Dispatches[I].State); }
    Json += TEXT("],\"positions\":[");
    for (int32 I=0; I<Samples.Num(); ++I) { if (I) Json += TEXT(","); const auto& S=Samples[I]; Json += FString::Printf(TEXT("{\"at\":%.4f,\"dt\":%.6f,\"x\":%.3f,\"y\":%.3f,\"z\":%.3f}"), S.At, S.Dt, S.Position.X, S.Position.Y, S.Position.Z); }
    Json += FString::Printf(TEXT("],\"engineStateProxy\":true,\"physicalOrDisplayLatency\":false,\"realtimeDiagnostics\":%s}"), *FinalDiagnostics);
    const FString File = Path(); IFileManager::Get().MakeDirectory(*FPaths::GetPath(File), true); FFileHelper::SaveStringToFile(Json, *File);
    UE_LOG(LogTemp, Display, TEXT("TV_REALTIME_PROBE status=%s passed=%d samples=%d dispatches=%d travel_cm=%.2f stopped=%d file=%s"), *Status, (Moved && Stopped && Error.IsEmpty()) ? 1 : 0, Samples.Num(), Dispatches.Num(), Travel, Stopped ? 1 : 0, *File);
    bRunning = false; FTSTicker::GetCoreTicker().RemoveTicker(TickHandle);
    if (FParse::Param(FCommandLine::Get(), TEXT("TVRealtimeProbeExit"))) FPlatformMisc::RequestExit(false);
}
static UWorld* FindWorld() {
    UWorld* Found = nullptr;
    if (!GEngine) return nullptr;
    for (const FWorldContext& C : GEngine->GetWorldContexts()) if (C.WorldType == EWorldType::Game || C.WorldType == EWorldType::PIE) { if (Found) return nullptr; Found = C.World(); }
    return Found;
}
static bool Tick(float) {
    if (!bRunning) return false;
    const double Now = FPlatformTime::Seconds(), Elapsed = Now - StartedAt;
    UWorld* World = FindWorld();
    if (!World) { if (Elapsed > 30.) Write(TEXT("failed"), TEXT("no unique Game/PIE world within 30 seconds")); return bRunning; }
    auto* Bridge = World->GetSubsystem<UTVBridgeSubsystem>(); auto* Player = Cast<ATVCharacter>(World->GetFirstPlayerController() ? World->GetFirstPlayerController()->GetPawn() : nullptr);
    if (!Bridge || !Player || !Bridge->IsLive() || !Bridge->HasPrediction()) { if (Elapsed > 30.) Write(TEXT("failed"), TEXT("bridge did not become live with prediction within 30 seconds")); return bRunning; }
    ProbeWorld = World; ProbePlayer = Player;
    FSample S; S.At = Elapsed; S.Dt = Samples.IsEmpty() ? 0. : Now - LastAt; S.Position = Player->GetActorLocation(); Samples.Add(S); LastAt = Now;
    if (StateAt == 0) StateAt = Now;
    const double Age = Now - StateAt;
    if (Bout < 10) {
        if (!bPressedW) { if (Age < .12) return bRunning; bSprintBout = (Bout % 2) == 1; if (bSprintBout) { Key(World, EKeys::LeftShift, IE_Pressed, TEXT("pressed")); bPressedShift = true; } Key(World, EKeys::W, IE_Pressed, TEXT("pressed")); bPressedW = true; StateAt = Now; }
        else if (Age >= .18) { Key(World, EKeys::W, IE_Released, TEXT("released")); bPressedW = false; if (bPressedShift) { Key(World, EKeys::LeftShift, IE_Released, TEXT("released")); bPressedShift = false; } ++Bout; LastReleaseAt = Now; StateAt = Now; }
    } else if (Age >= .45) {
        int32 TailSamples = 0;
        for (const auto& Sample : Samples) if (Sample.At >= LastReleaseAt - StartedAt + .1) ++TailSamples;
        if (TailSamples >= 8) Write(TEXT("complete"));
        else if (Age >= 2.) Write(TEXT("failed"), TEXT("insufficient released-tail frames within two seconds"));
    }
    return bRunning;
}
static void Start(const TArray<FString>&) {
    if (bRunning) return;
    bRunning = true; StartedAt = FPlatformTime::Seconds(); Bout = 0; StateAt = 0; LastAt = StartedAt; LastReleaseAt = StartedAt; bPressedW = bPressedShift = false; ProbeWorld.Reset(); ProbePlayer.Reset(); Samples.Empty(); Dispatches.Empty();
    TickHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&Tick));
    UE_LOG(LogTemp, Display, TEXT("TV_REALTIME_PROBE started; waits up to 30 seconds for live prediction"));
}
static FAutoConsoleCommand Command(TEXT("TV.RealtimeProbe"), TEXT("Run bounded native realtime prediction probe; optionally pass -TVRealtimeProbeExit."), FConsoleCommandWithArgsDelegate::CreateStatic(&Start));
}
#endif
