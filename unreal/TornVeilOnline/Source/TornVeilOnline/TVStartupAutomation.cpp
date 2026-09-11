// Editor-only acceptance input. Dispatches the same PlayerController key event as a
// keyboard, through the configured WASD axis bindings. Never edits pawn/world positions.
#include "CoreMinimal.h"
#if WITH_EDITOR && WITH_DEV_AUTOMATION_TESTS
#include "HAL/IConsoleManager.h"
#include "Engine/Engine.h"
#include "GameFramework/PlayerController.h"
#include "InputKeyEventArgs.h"
#include "TimerManager.h"
#include "GenericPlatform/GenericPlatformInputDeviceMapper.h"

static FAutoConsoleCommand TVStartupKey(
    TEXT("TV.TestMoveKey"),TEXT("PIE acceptance: TV.TestMoveKey W|A|S|D|LeftShift [seconds <= 5]. Native input only."),
    FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args) {
        if(Args.Num()<1 || !TArray<FString>{TEXT("W"),TEXT("A"),TEXT("S"),TEXT("D"),TEXT("LeftShift")}.Contains(Args[0])) return;
        UWorld* World=nullptr;
        for(const auto& Context:GEngine->GetWorldContexts()) if(Context.WorldType==EWorldType::PIE) { if(World) {UE_LOG(LogTemp,Error,TEXT("TV_STARTUP_TEST requires exactly one PIE world"));return;} World=Context.World(); }
        if(!World || !World->GetFirstPlayerController()) return;
        auto* PC=World->GetFirstPlayerController();const FKey Key(*Args[0]);
        const float Seconds=FMath::Clamp(Args.Num()>1?FCString::Atof(*Args[1]):2.f,.1f,5.f);
        PC->InputKey(FInputKeyEventArgs(nullptr,IPlatformInputDeviceMapper::Get().GetDefaultInputDevice(),Key,IE_Pressed,1.f,false,FPlatformTime::Cycles64()));
        UE_LOG(LogTemp,Display,TEXT("TV_STARTUP_TEST native key=%s pressed seconds=%.2f"),*Args[0],Seconds);
        FTimerHandle Timer;
        World->GetTimerManager().SetTimer(Timer,FTimerDelegate::CreateWeakLambda(PC,[PC,Key]() {PC->InputKey(FInputKeyEventArgs(nullptr,IPlatformInputDeviceMapper::Get().GetDefaultInputDevice(),Key,IE_Released,0.f,false,FPlatformTime::Cycles64()));UE_LOG(LogTemp,Display,TEXT("TV_STARTUP_TEST native key=%s released"),*Key.ToString());}),Seconds,false);
    }));
#endif
