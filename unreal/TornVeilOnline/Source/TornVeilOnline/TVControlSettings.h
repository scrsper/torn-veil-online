#pragma once
#include "CoreMinimal.h"
#include "InputModifiers.h"
#include "TVControlSettings.generated.h"

// Presentation preferences only; canonical movement and combat never read these settings.
UCLASS(Config=GameUserSettings)
class TORNVEILONLINE_API UTVControlSettings : public UObject {
    GENERATED_BODY()
public:
    UPROPERTY(Config) float MouseSensitivity=.15f;
    UPROPERTY(Config) float ControllerX=140.f;
    UPROPERTY(Config) float ControllerY=110.f;
    UPROPERTY(Config) float MoveDeadZone=.18f;
    UPROPERTY(Config) float LookDeadZone=.15f;
    UPROPERTY(Config) bool bInvertY=false;
    UPROPERTY(Config) bool bVibration=true;
    UPROPERTY(Config) bool bSprintToggle=false;
    UPROPERTY(Config) bool bFocusToggle=false;
    static FString DeviceFamily(class ULocalPlayer* Player);
    static FString Glyph(class ULocalPlayer* Player,FName Action);
    static FString KeyGlyph(FKey Key,bool bPlayStation);
    static bool Rebind(class UInputSettings* Settings,FName Action,FKey Key,bool bPersist=true);
    static float Stick(float Value,float DeadZone);
    void Adjust(const FString& Setting);
    FString Describe() const;
};

UCLASS()
class TORNVEILONLINE_API UTVControlModifier : public UInputModifier {
    GENERATED_BODY()
public:
    bool bGamepad=false,bCamera=false,bVertical=false;
protected:
    virtual FInputActionValue ModifyRaw_Implementation(const UEnhancedPlayerInput*, FInputActionValue Value,float Dt) override;
};
