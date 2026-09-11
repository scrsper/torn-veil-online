#include "CoreMinimal.h"

#if WITH_DEV_AUTOMATION_TESTS
#include "TVBridgeSubsystem.h"
#include "TVCharacter.h"
#include "Engine/Engine.h"
#include "EngineUtils.h"
#include "UnrealClient.h"
#include "Misc/AutomationTest.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Containers/Ticker.h"
#include "GameFramework/PlayerController.h"
#include "GenericPlatform/GenericPlatformInputDeviceMapper.h"
#include "InputKeyEventArgs.h"
#include "InputCoreTypes.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

namespace TVLiveCombatRuntimeProbe {
static bool Running = false;
static double Started = 0;
static FTSTicker::FDelegateHandle Handle;
static TWeakObjectPtr<UWorld> World;
static TWeakObjectPtr<ATVCharacter> Player;
static TArray<FString> Samples;
static int32 Phase = 0;
static double LastFrameAt = 0;
static double LiveAt = -1;
static double DodgeDelay = .45;
static bool DefenseOnly = false;
static FString DefenseKind;
static bool PrepObserved = false;
static double PrepObservedAt = -1;
static bool CaptureFrames = false;
static double LastShotAt = 0;
static int32 CaptureIndex = 0;
static FString CaptureDir;
static int32 RepetitionCount = 0;
static int32 RepetitionIndex = 0;
static int32 RepetitionAttackInputs = 0;
static int32 RepetitionDuckInputs = 0;
static double NextRepetitionAt = 0;

static FString Compact(const FString& Source, std::initializer_list<const TCHAR*> Fields) {
    TSharedPtr<FJsonObject> In; const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Source);
    if (!FJsonSerializer::Deserialize(Reader, In) || !In.IsValid()) return TEXT("{}");
    TSharedPtr<FJsonObject> Out = MakeShared<FJsonObject>();
    for (const TCHAR* Field : Fields) if (const TSharedPtr<FJsonValue>* Value = In->Values.Find(Field)) Out->SetField(Field, *Value);
    FString Result; auto Writer = TJsonWriterFactory<>::Create(&Result); FJsonSerializer::Serialize(Out.ToSharedRef(), Writer); Writer->Close(); return Result;
}
static bool IsPreparation(const FString& Source) {
    TSharedPtr<FJsonObject> In; const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Source);
    FString PhaseName; return FJsonSerializer::Deserialize(Reader, In) && In.IsValid() && In->TryGetStringField(TEXT("livePhase"), PhaseName) && PhaseName == TEXT("preparation");
}

static void Input(UWorld* W, const FKey& Key, const TCHAR* Label) {
    if (!W || !W->GetFirstPlayerController()) return;
    auto* PC = W->GetFirstPlayerController();
    PC->InputKey(FInputKeyEventArgs(nullptr, IPlatformInputDeviceMapper::Get().GetDefaultInputDevice(), Key, IE_Pressed, 1.f, false, FPlatformTime::Cycles64()));
    UE_LOG(LogTemp, Display, TEXT("TV_LIVE_COMBAT_INPUT %s"), Label);
    if (FCString::Stristr(Label, TEXT("repetition_attack"))) ++RepetitionAttackInputs;
    if (FCString::Stristr(Label, TEXT("repetition_duck"))) ++RepetitionDuckInputs;
    Samples.Add(FString::Printf(TEXT("{\"atMs\":%.3f,\"event\":\"%s\"}"), (FPlatformTime::Seconds() - Started) * 1000, Label));
}

static void Finish(const TCHAR* Status, const FString& Error = FString()) {
    FString Json = FString::Printf(TEXT("{\"status\":\"%s\",\"error\":\"%s\",\"samples\":["), Status, *Error.Replace(TEXT("\""), TEXT("'")));
    for (int32 I = 0; I < Samples.Num(); ++I) { if (I) Json += TEXT(","); Json += Samples[I]; }
    FString Diagnostics = TEXT("{}");
    if (auto* B = World.IsValid() ? World->GetSubsystem<UTVBridgeSubsystem>() : nullptr) Diagnostics = B->RealtimeDiagnostics();
    FString Presentation = TEXT("{}");
    if (auto* P = Player.Get()) Presentation = P->PresentationDiagnostics();
    Json += FString::Printf(TEXT("],\"realtimeDiagnostics\":%s,\"presentation\":%s,\"repetition\":{\"requested\":%d,\"dispatched\":%d,\"attackInputs\":%d,\"duckInputs\":%d}}"), *Diagnostics, *Presentation, RepetitionCount, RepetitionIndex, RepetitionAttackInputs, RepetitionDuckInputs);
    const FString File = FPaths::ProjectDir() / TEXT("../../docs/evidence/realtime/native-live-combat-standalone.json");
    IFileManager::Get().MakeDirectory(*FPaths::GetPath(File), true); FFileHelper::SaveStringToFile(Json, *File);
    UE_LOG(LogTemp, Display, TEXT("TV_LIVE_COMBAT_PROBE status=%s samples=%d file=%s"), Status, Samples.Num(), *File);
    Running = false; FTSTicker::GetCoreTicker().RemoveTicker(Handle);
    if (FParse::Param(FCommandLine::Get(), TEXT("TVLiveCombatProbeExit"))) FPlatformMisc::RequestExit(false);
}

static bool Tick(float) {
    if (!Running) return false;
    const double Now = FPlatformTime::Seconds(), Age = Now - Started;
    if (!World.IsValid() || !Player.IsValid()) {
        UWorld* Found = nullptr;
        if (GEngine) for (const FWorldContext& C : GEngine->GetWorldContexts()) if (C.WorldType == EWorldType::Game || C.WorldType == EWorldType::PIE) { if (Found) return true; Found = C.World(); }
        if (Found) { World = Found; Player = Cast<ATVCharacter>(Found->GetFirstPlayerController() ? Found->GetFirstPlayerController()->GetPawn() : nullptr); }
    }
    auto* B = World.IsValid() ? World->GetSubsystem<UTVBridgeSubsystem>() : nullptr;
    if (!B || !Player.IsValid() || !B->IsLive()) { if (Age > 30) Finish(TEXT("failed"), TEXT("bridge did not become live")); return true; }
    const double FrameAt = FPlatformTime::Seconds();
    if (LastFrameAt > 0) {
        const FString Diagnostics = Compact(B->RealtimeDiagnostics(), {TEXT("clockUncertaintyMs"),TEXT("pendingMovement"),TEXT("predictionCount"),TEXT("predictionReady"),TEXT("inputToPredictedAttackMs"),TEXT("inputToPredictedDefenseMs"),TEXT("combatCorrectionCm"),TEXT("combatCorrectionCpuMs"),TEXT("combatCorrectionSettleMs"),TEXT("remoteActionAgeMs"),TEXT("contactReceiveToPresentationMs"),TEXT("contactDecisionToPresentationMs"),TEXT("predictionCpuMs"),TEXT("appliedRoundTripMs"),TEXT("combatAppliedRoundTripMs")});
        const FString Presentation = Compact(Player->PresentationDiagnostics(), {TEXT("entityId"),TEXT("pose"),TEXT("attackSeq"),TEXT("hitSeq"),TEXT("playedAttacks"),TEXT("playedHits"),TEXT("liveCombat"),TEXT("liveActionId"),TEXT("liveCommandId"),TEXT("livePhase"),TEXT("liveKind"),TEXT("liveOutcome"),TEXT("duck"),TEXT("choreographyActive"),TEXT("choreographyDropped"),TEXT("presentationOffsetCm"),TEXT("maxPresentationOffsetCm"),TEXT("plannedContactErrorCm"),TEXT("measuredContactErrorCm"),TEXT("choreographyAge"),TEXT("position"),TEXT("headHeightCm"),TEXT("pelvisHeightCm"),TEXT("footSeparationCm")});
        const FVector Position = Player->GetActorLocation();
        Samples.Add(FString::Printf(TEXT("{\"atMs\":%.3f,\"event\":\"frame\",\"frameDtMs\":%.3f,\"position\":{\"x\":%.3f,\"y\":%.3f,\"z\":%.3f},\"bridge\":%s,\"presentation\":%s}"),
            (FrameAt - Started) * 1000, (FrameAt - LastFrameAt) * 1000, Position.X, Position.Y, Position.Z, *Diagnostics, *Presentation));
    }
    LastFrameAt = FrameAt;
    if (CaptureFrames && FrameAt - LastShotAt >= (1.0 / 30.0)) {
        const FString File = CaptureDir / FString::Printf(TEXT("frame-%04d.png"), CaptureIndex++);
        FScreenshotRequest::RequestScreenshot(File, false, false);
        Samples.Add(FString::Printf(TEXT("{\"atMs\":%.3f,\"event\":\"renderer_screenshot\",\"path\":\"%s\"}"), (FrameAt - Started) * 1000, *File.Replace(TEXT("\\"), TEXT("/"))));
        LastShotAt = FrameAt;
    }
    if (LiveAt < 0) LiveAt = Age;
    const double CombatAge = Age - LiveAt;
    if (DefenseOnly && !PrepObserved && CombatAge > 30.0) { Finish(TEXT("failed"), TEXT("remote preparation was not observed")); return false; }
    if (DefenseOnly && !PrepObserved) {
        for (TActorIterator<ATVCharacter> It(World.Get()); It; ++It) {
            if (It->IsPlayerControlled()) continue;
            const FString Other = It->PresentationDiagnostics();
            if (IsPreparation(Other)) {
                PrepObserved = true; PrepObservedAt = Age;
                Samples.Add(FString::Printf(TEXT("{\"atMs\":%.3f,\"event\":\"remote_preparation_observed\"}"), (FPlatformTime::Seconds() - Started) * 1000));
                break;
            }
        }
    }
    const double ResponseAge = DefenseOnly && PrepObserved ? Age - PrepObservedAt : CombatAge;
    if (RepetitionCount > 0) {
        if (RepetitionIndex < RepetitionCount && CombatAge >= NextRepetitionAt) {
            const bool bAttack = (RepetitionIndex % 2) == 0;
            Input(World.Get(), bAttack ? EKeys::R : EKeys::LeftControl, bAttack ? TEXT("repetition_attack") : TEXT("repetition_duck"));
            UE_LOG(LogTemp, Display, TEXT("TV_LIVE_COMBAT_REPETITION index=%d kind=%s atMs=%.3f"), RepetitionIndex, bAttack ? TEXT("attack") : TEXT("duck"), CombatAge * 1000.0);
            ++RepetitionIndex;
            NextRepetitionAt += 1.0;
        } else if (RepetitionIndex >= RepetitionCount && CombatAge >= NextRepetitionAt + .75) {
            Finish(TEXT("complete"));
            return false;
        }
        return Running;
    }
    if (DefenseOnly && Phase == 0 && PrepObserved && ResponseAge > DodgeDelay) {
        const bool bDuck = DefenseKind == TEXT("duck");
        const bool bBackstep = DefenseKind == TEXT("backstep");
        Input(World.Get(), bDuck ? EKeys::LeftControl : (bBackstep ? EKeys::SpaceBar : EKeys::Z), bDuck ? TEXT("LeftCtrl_duck_after_prep") : (bBackstep ? TEXT("Space_backstep_after_prep") : TEXT("Z_left_step_after_prep")));
        Phase = 2;
    }
    else if (!DefenseOnly && Phase == 0 && CombatAge > .5) { Input(World.Get(), EKeys::R, TEXT("R_low_attack_pressed")); Phase = 1; }
    else if (!DefenseOnly && Phase == 1 && CombatAge > (.5 + DodgeDelay)) { Input(World.Get(), EKeys::Z, TEXT("Z_left_step_pressed")); Phase = 2; }
    else if (Phase == 2 && ResponseAge > (DefenseOnly ? .9 : 1.7)) { Input(World.Get(), EKeys::LeftControl, TEXT("LeftCtrl_duck_pressed")); if (GEngine) GEngine->Exec(World.Get(), TEXT("HighResShot 1280x720")); Samples.Add(FString::Printf(TEXT("{\"atMs\":%.3f,\"event\":\"HighResShot_1280x720\"}"), (FPlatformTime::Seconds() - Started) * 1000)); Phase = 3; }
    else if (Phase == 3 && ResponseAge > (DefenseOnly ? 2.0 : 2.8)) Finish(TEXT("complete"));
    return Running;
}

static void Start(const TArray<FString>&) {
    if (Running) return; Running = true; Started = FPlatformTime::Seconds(); Phase = 0; LiveAt = -1; PrepObserved = false; PrepObservedAt = -1; LastFrameAt = 0; LastShotAt = 0; CaptureIndex = 0; RepetitionIndex = 0; RepetitionAttackInputs = 0; RepetitionDuckInputs = 0; NextRepetitionAt = .5; RepetitionCount = FMath::Max(0, FCString::Atoi(*FPlatformMisc::GetEnvironmentVariable(TEXT("TV_LIVE_COMBAT_REPETITIONS")))); CaptureFrames = FPlatformMisc::GetEnvironmentVariable(TEXT("TV_LIVE_COMBAT_CAPTURE")) == TEXT("1"); CaptureDir = FPlatformMisc::GetEnvironmentVariable(TEXT("TV_LIVE_COMBAT_CAPTURE_DIR")); if (CaptureDir.IsEmpty()) CaptureDir = FPaths::ProjectDir() / TEXT("../../.debug/live-combat-frames"); if (CaptureFrames) { IFileManager::Get().MakeDirectory(*CaptureDir, true); } DefenseOnly = FPlatformMisc::GetEnvironmentVariable(TEXT("TV_LIVE_COMBAT_DEFENSE_ONLY")) == TEXT("1"); DefenseKind = FPlatformMisc::GetEnvironmentVariable(TEXT("TV_LIVE_COMBAT_DEFENSE_KIND")); if (DefenseKind.IsEmpty()) DefenseKind = TEXT("sidestep"); DodgeDelay = FMath::Max(0., FCString::Atod(*FPlatformMisc::GetEnvironmentVariable(TEXT("TV_LIVE_COMBAT_DODGE_DELAY")))); if (DodgeDelay <= 0) DodgeDelay = DefenseOnly ? .10 : .45; Samples.Empty(); World.Reset(); Player.Reset();
    Handle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&Tick));
    UE_LOG(LogTemp, Display, TEXT("TV_LIVE_COMBAT_PROBE started; waiting for live bridge"));
}
static FAutoConsoleCommand Command(TEXT("TV.LiveCombatProbe"), TEXT("Run bounded native live combat input probe"), FConsoleCommandWithArgsDelegate::CreateStatic(&Start));
}
#endif
