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
    void CycleTarget();
    ATVCharacter* Selected() const;
    FString Status = TEXT("Connecting to simulation..."), LastResult, LastEvent, PlayerId;
    float ServerTick = 0, SinceSnapshot = 100;
    bool bInspector = false, bControls = false;
    UPROPERTY() TMap<FString, TObjectPtr<ATVCharacter>> Bodies;
private:
    TSharedPtr<IWebSocket> Socket;
    FString SelectedBody;
    int32 Sequence = 0;
    float SendClock = 0, RetryClock = 0;
    void Connect();
    void Receive(const FString& Message);
    void Send(const TSharedRef<class FJsonObject>& Message);
};
