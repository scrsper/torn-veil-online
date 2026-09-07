#pragma once
#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "TVBridgeSubsystem.generated.h"

class IWebSocket;
class ATVCharacter;
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
    UPROPERTY(BlueprintReadOnly) FString PlayerVitals;
    UPROPERTY(BlueprintReadOnly) FString CarriedSummary;
    UPROPERTY(BlueprintReadOnly) FString NearbyPrompt;
    UPROPERTY(BlueprintReadOnly) FString ConsumePrompt;
    FString NearbyInteraction, ConsumeInteraction;
    void CycleTarget();
    ATVCharacter* Selected() const;
    FString Status = TEXT("Connecting to simulation..."), LastResult, LastEvent, PlayerId;
    float ServerTick = 0, SinceSnapshot = 100;
    bool bInspector = false, bControls = false;
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
    void Connect();
    void Receive(const FString& Message);
    void Send(const TSharedRef<class FJsonObject>& Message);
};
