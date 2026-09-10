#pragma once
#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "TVBridgeSubsystem.generated.h"

class IWebSocket;
class ATVCharacter;
class ATVWorldProjection;
UCLASS()
class TORNVEILONLINE_API UTVBridgeSubsystem : public UTickableWorldSubsystem {
    GENERATED_BODY()
public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;
    virtual void Tick(float DeltaTime) override;
    virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UTVBridgeSubsystem, STATGROUP_Tickables); }
    virtual bool DoesSupportWorldType(EWorldType::Type Type) const override { return Type == EWorldType::Game || Type == EWorldType::PIE; }
    void SendIntent(const FString& Type, const FString& TargetBody = TEXT(""));
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
    bool bMechanismsOpen = false;
    TArray<FString> MechanismLabels;
    TArray<TSharedPtr<FJsonObject>> MechanismIntents;
    FString KnowledgeSummary, ProjectionMetrics;
    UPROPERTY() TObjectPtr<ATVWorldProjection> WorldProjection;
    ATVCharacter* Selected() const;
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
};
