#pragma once
#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "TVCombatChoreography.h"
#include "TVInteractionPrediction.h"
#include "TVLiveCombat.h"
#include "TVBridgeSubsystem.generated.h"

class IWebSocket;
class ATVCharacter;
class ATVWorldProjection;
UCLASS()
class TORNVEILONLINE_API UTVBridgeSubsystem : public UTickableWorldSubsystem {
    GENERATED_BODY()
#if WITH_DEV_AUTOMATION_TESTS
    friend class FTVLiveCombatReconciliation;
#endif
public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;
    virtual void Tick(float DeltaTime) override;
    virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UTVBridgeSubsystem, STATGROUP_Tickables); }
    virtual bool DoesSupportWorldType(EWorldType::Type Type) const override { return Type == EWorldType::Game || Type == EWorldType::PIE; }
    void SendIntent(const FString& Type, const FString& TargetBody = TEXT(""));
    void SendCombat(const FString& Kind,int32 Side=1,const FString& Trajectory=TEXT("high"),double CallbackAt=0,const FVector& Direction=FVector::ZeroVector);
    void SendHandIntent(bool bConsume);
    void SendDropIntent();
    /** Opens/advances a TypeScript-owned dialogue session.  Native code receives rendered
     * strings and opaque option ids only; it never recreates an NPC's knowledge or choices. */
    void Interact();
    void CloseDialogue();
    void ChooseDialogueOption(int32 Index);
    UPROPERTY(BlueprintReadOnly) FString PlayerVitals;
    UPROPERTY(BlueprintReadOnly) FString CarriedSummary;
    UPROPERTY(BlueprintReadOnly) FString NearbyPrompt;
    UPROPERTY(BlueprintReadOnly) FString ConsumePrompt;
    UPROPERTY(BlueprintReadOnly) FString DropPrompt;
    FString NearbyInteraction, ConsumeInteraction, DropInteraction;
    FString TalkTargetBody;
    bool bDialogueOpen = false;
    FString DialogueSpeaker, DialogueOccupation;
    TArray<FString> DialogueLines, DialogueOptionIds, DialogueOptionLabels;
    void CycleTarget();
    void ToggleMechanisms();
    void ChooseMechanism(int32 Index);
    void RequestDeveloperInspection();
    void SaveWorld();
    void PredictMovement(float Dt,const FVector& Direction,bool bSprint);
    void NoteInput();
    UFUNCTION(BlueprintCallable,Category="Torn Veil|Diagnostics") FString RealtimeDiagnostics() const;
    bool HasPrediction() const {return bPredictionReady&&IsLive()&&bControls;}
    FVector PredictedLocation() const {return ToUnreal(Predicted.Position);}
    double PredictedYaw() const {return FMath::RadiansToDegrees(FMath::Atan2(-FMath::Cos(Predicted.Yaw),-FMath::Sin(Predicted.Yaw)));}
    FVector RenderCorrection=FVector::ZeroVector;
    FVector PredictionVelocity=FVector::ZeroVector;
    double LastPredictionMs=0,MaxPredictionMs=0,LastInputToStateMs=0,CorrectionCm=0,MaxCorrectionCm=0;
    int32 CorrectionCount=0,PredictionCount=0;
    bool bMechanismsOpen = false;
    TArray<FString> MechanismLabels;
    TArray<TSharedPtr<FJsonObject>> MechanismIntents;
    FString KnowledgeSummary, ProjectionMetrics;
    UPROPERTY() TObjectPtr<ATVWorldProjection> WorldProjection;
    UPROPERTY() TObjectPtr<class UInstancedStaticMeshComponent> ArenaBlocks;
    bool bArena=false;
    FString PracticeStatus=TEXT("Scripted practice: passive target"),PracticeLast;
    void SetPractice(const FString& Mode);
    void RefreshArenaBlocks();
    ATVCharacter* Selected() const;
    FTVCombatReplayCursor CombatCursor;
    FString Status = TEXT("Connecting to simulation..."), LastResult, LastEvent, PlayerId;
    float ServerTick = 0;
    UPROPERTY(BlueprintReadOnly) float SinceSnapshot = 100;
    UPROPERTY(BlueprintReadOnly) bool bControls = false;
    UPROPERTY(BlueprintReadOnly) bool bTransportConnected = false;
    UPROPERTY(BlueprintReadOnly) bool bCanonicalReady = false;
    UPROPERTY(BlueprintReadOnly) int32 SnapshotCount = 0;
    UPROPERTY(BlueprintReadOnly) int32 ProjectedRegions = 0;
    UPROPERTY(BlueprintReadOnly) FString CenterRegion;
    UFUNCTION(BlueprintPure) bool IsLive() const;
    UFUNCTION(BlueprintPure) FString ConnectionStatus() const;
    bool bInspector = false;
    /** Canonical metre->centimetre projection, taken from the bridge's `scene` message rather
     * than baked in here. TypeScript owns where the world's origin is. */
    FVector CanonicalOrigin = FVector(96, 14, 96);
    float UnitsPerMetre = 100;
    FVector ToUnreal(const FVector& Metres) const {
        return FVector((Metres.X - CanonicalOrigin.X) * UnitsPerMetre, (Metres.Z - CanonicalOrigin.Z) * UnitsPerMetre, (Metres.Y - CanonicalOrigin.Y) * UnitsPerMetre + 90);
    }
    UPROPERTY() TMap<FString, TObjectPtr<ATVCharacter>> Bodies;
private:
    TSharedPtr<IWebSocket> Socket;
    FString SelectedBody;
    int32 Sequence = 0;
    float SendClock = 0, RetryClock = 0, ResultClock = 0;
    double LastSnapshotReceived = 0;
    bool bWasLive = false, bMovingInput = false;
    TSet<FString> WantedRegions;
    TArray<uint8> Assembly;
    int32 TransferId = 0, NextChunk = 0, ChunkCount = 0;
    FString TransferRegion;
    TSharedPtr<FJsonObject> PendingPresentation;
    void AcknowledgePresentation(int32 Id, int32 Index);
    void ProtocolError(const FString& Reason);
    void ReceivePresentation(const TSharedPtr<FJsonObject>& Message);
    void Connect();
    void Receive(const FString& Message);
    void Send(const TSharedRef<class FJsonObject>& Message);
    int32 SendCommand(const TSharedRef<FJsonObject>& Command);
    void ReceiveLocalState(const TSharedPtr<FJsonObject>& Message);
    TOptional<FTVPredictionColumn> PredictionColumn(int32 X,int32 Z) const;
    FString InteractionEpoch,InteractionController,InteractionBody;
    FTVMovementState Confirmed,Predicted;
    struct FPendingMovement {int32 Sequence;FTVMovementInput Input;FTVLiveCombat Action;double ActionAge=0;};
    TArray<FPendingMovement> PendingMovement;
    TMap<int32,double> CommandSentAt;
    TArray<FTVPredictionColumn> PredictionColumns;
    int32 GeometryX=0,GeometryZ=0,GeometrySize=0;
    double PredictionAccumulator=0,InputCallbackAt=0,LastLocalStateAt=0,LastConfirmedTick=-1;
    bool bPredictionReady=false;
    int32 PendingFeedbackSequence=-1;
    TArray<double> PredictionSamples,InputToStateSamples,AppliedRttSamples,CorrectionSamples;
    FTVLiveCombat PredictedCombat;
    double CombatAge=0;
    int32 CombatCommandSequence=-1;
    struct FBufferedCombat {FString Kind,Trajectory,CommandId;FVector Direction=FVector::ZeroVector;int32 Side=1,Sequence=-1;double InputAt=0,ExpiresAt=0;bool bBuffered=false;};
    TOptional<FBufferedCombat> BufferedCombat;
    void StartPredictedCombat(const FBufferedCombat& Input);
    void AdvanceCombatBuffer();
    double LastCombatStartAt=0;
    TArray<double> CombatStartGapSamples,CombatBufferSamples,CombatBufferedWaitSamples,CombatTransitionLateSamples;
    TArray<double> AttackInputSamples,DefenseInputSamples,CombatCorrectionSamples,CombatCorrectionTimeSamples,RemoteActionAgeSamples,ContactReceiveSamples;
    double ClockOffsetMs=0,ClockUncertaintyMs=1e9,ClockProbeAt=0;
    TSet<FString> PresentedContacts;
    TArray<FString> PresentedContactOrder;
    double CombatCorrectionStartedAt=-1;
    TArray<double> CombatCorrectionSettleSamples,CommandOutboundSamples,CommandApplicationSamples,CommandInboundSamples;
    TArray<double> ContactDecisionSamples;
    TArray<double> CombatAnimationSetupSamples,CombatAppliedRttSamples;
    void ObserveCombat(const TSharedPtr<FJsonObject>& Message,double Tick,double ReceivedAtMs,bool Motion);
};
