#include "TVControlSettings.h"
#include "CommonInputSubsystem.h"
#include "Engine/LocalPlayer.h"
#include "Engine/Engine.h"
#include "GameFramework/InputDeviceSubsystem.h"
#include "GameFramework/InputSettings.h"

float UTVControlSettings::Stick(float Value,float DeadZone) {
    const float D=FMath::Clamp(DeadZone,0.f,.45f);
    return FMath::Sign(Value)*FMath::Clamp((FMath::Abs(Value)-D)/(1.f-D),0.f,1.f);
}
void UTVControlSettings::Adjust(const FString& K) {
    if(K==TEXT("Mouse"))MouseSensitivity=MouseSensitivity>=.5f?.05f:MouseSensitivity+.05f;
    else if(K==TEXT("ControllerX"))ControllerX=ControllerX>=240?60:ControllerX+20;
    else if(K==TEXT("ControllerY"))ControllerY=ControllerY>=220?50:ControllerY+20;
    else if(K==TEXT("MoveDeadZone"))MoveDeadZone=MoveDeadZone>=.35f?.05f:MoveDeadZone+.05f;
    else if(K==TEXT("LookDeadZone"))LookDeadZone=LookDeadZone>=.35f?.05f:LookDeadZone+.05f;
    else if(K==TEXT("InvertY"))bInvertY=!bInvertY;
    else if(K==TEXT("Vibration"))bVibration=!bVibration;
    else if(K==TEXT("SprintToggle"))bSprintToggle=!bSprintToggle;
    else if(K==TEXT("FocusToggle"))bFocusToggle=!bFocusToggle;
    SaveConfig();
}
FString UTVControlSettings::Describe() const {
    return FString::Printf(TEXT("Mouse %.2f   Controller X %.0f / Y %.0f\nMove dead zone %.2f   Look dead zone %.2f\nInvert Y: %s   Vibration: %s\nSprint: %s   Focus: %s"),MouseSensitivity,ControllerX,ControllerY,MoveDeadZone,LookDeadZone,bInvertY?TEXT("On"):TEXT("Off"),bVibration?TEXT("On"):TEXT("Off"),bSprintToggle?TEXT("Toggle"):TEXT("Hold"),bFocusToggle?TEXT("Toggle"):TEXT("Hold"));
}
FInputActionValue UTVControlModifier::ModifyRaw_Implementation(const UEnhancedPlayerInput*,FInputActionValue V,float Dt) {
    const auto* S=GetDefault<UTVControlSettings>();float Value=V.Get<float>();
    if(bGamepad)Value=UTVControlSettings::Stick(Value,bCamera?S->LookDeadZone:S->MoveDeadZone);
    if(bCamera)Value*=bGamepad?(bVertical?S->ControllerY:S->ControllerX)*Dt:S->MouseSensitivity;
    if(bCamera&&bVertical&&S->bInvertY)Value=-Value;
    return FInputActionValue(Value);
}

FString UTVControlSettings::DeviceFamily(ULocalPlayer* Player){
    const auto* Input=Player?Player->GetSubsystem<UCommonInputSubsystem>():nullptr;
    if(!Input||Input->GetCurrentInputType()!=ECommonInputType::Gamepad)return TEXT("Keyboard");
    const auto* Devices=GEngine?GEngine->GetEngineSubsystem<UInputDeviceSubsystem>():nullptr;
    const FString Id=Devices?Devices->GetMostRecentlyUsedHardwareDevice(Player->GetPlatformUserId()).HardwareDeviceIdentifier.ToString():Input->GetCurrentGamepadName().ToString();
    return Id.Contains(TEXT("DualSense"))||Id.Contains(TEXT("DualShock"))||Id.Contains(TEXT("PlayStation"))?TEXT("PlayStation"):TEXT("Xbox");
}
FString UTVControlSettings::KeyGlyph(FKey Key,bool PS){
    if(!Key.IsGamepadKey())return Key.GetDisplayName().ToString();
    if(Key==EKeys::Gamepad_FaceButton_Bottom)return PS?TEXT("Cross ×"):TEXT("A");
    if(Key==EKeys::Gamepad_FaceButton_Right)return PS?TEXT("Circle ○"):TEXT("B");
    if(Key==EKeys::Gamepad_FaceButton_Left)return PS?TEXT("Square □"):TEXT("X");
    if(Key==EKeys::Gamepad_FaceButton_Top)return PS?TEXT("Triangle △"):TEXT("Y");
    if(Key==EKeys::Gamepad_LeftShoulder)return PS?TEXT("L1"):TEXT("LB");
    if(Key==EKeys::Gamepad_RightShoulder)return PS?TEXT("R1"):TEXT("RB");
    if(Key==EKeys::Gamepad_LeftTrigger)return PS?TEXT("L2"):TEXT("LT");
    if(Key==EKeys::Gamepad_RightTrigger)return PS?TEXT("R2"):TEXT("RT");
    if(Key==EKeys::Gamepad_LeftThumbstick)return TEXT("L3");
    if(Key==EKeys::Gamepad_RightThumbstick)return TEXT("R3");
    if(Key==EKeys::Gamepad_Special_Left)return PS?TEXT("Create / Touchpad"):TEXT("View");
    if(Key==EKeys::Gamepad_Special_Right)return PS?TEXT("Options"):TEXT("Menu");
    return Key.GetDisplayName().ToString();
}
FString UTVControlSettings::Glyph(ULocalPlayer* Player,FName Action){
    const FString Family=DeviceFamily(Player);const bool Gamepad=Family!=TEXT("Keyboard");
    TArray<FInputActionKeyMapping> Mappings;GetDefault<UInputSettings>()->GetActionMappingByName(Action,Mappings);
    for(const auto& M:Mappings)if(M.Key.IsGamepadKey()==Gamepad)return KeyGlyph(M.Key,Family==TEXT("PlayStation"));
    return TEXT("Unbound");
}

bool UTVControlSettings::Rebind(UInputSettings* Settings,FName Action,FKey Key,bool Persist){
    if(!Settings||!Key.IsValid()||Key.IsAnalog()||Key==EKeys::Escape||Key==EKeys::Gamepad_Special_Right)return false;
    FName Axis;float Scale=0;
    if(Action==TEXT("MoveForward")){Axis=TEXT("Forward");Scale=1;}
    if(Action==TEXT("MoveBack")){Axis=TEXT("Forward");Scale=-1;}
    if(Action==TEXT("MoveRight")){Axis=TEXT("Right");Scale=1;}
    if(Action==TEXT("MoveLeft")){Axis=TEXT("Right");Scale=-1;}
    if(!Axis.IsNone()&&Key.IsGamepadKey())return false; // sticks remain analog
    const auto Actions=Settings->GetActionMappings();const auto Axes=Settings->GetAxisMappings();FKey Previous;
    for(const auto& M:Actions)if(Axis.IsNone()&&M.ActionName==Action&&M.Key.IsGamepadKey()==Key.IsGamepadKey()&&!Previous.IsValid())Previous=M.Key;
    for(const auto& M:Axes)if(M.AxisName==Axis&&M.Scale==Scale&&!M.Key.IsGamepadKey()&&!Previous.IsValid())Previous=M.Key;
    const auto IsUI=[](FName N){return N==TEXT("UIConfirm")||N==TEXT("UIUp")||N==TEXT("UIDown")||N==TEXT("UIBack")||N==TEXT("PauseMenu");};
    if(IsUI(Action))return false;
    if(!Previous.IsValid()){
        for(const auto& M:Actions)if(M.Key==Key&&!IsUI(M.ActionName))return false;
        for(const auto& M:Axes)if(M.Key==Key)return false;
    }
    for(const auto& M:Actions){
        if(Axis.IsNone()&&M.ActionName==Action&&M.Key.IsGamepadKey()==Key.IsGamepadKey())Settings->RemoveActionMapping(M,false);
        else if(M.Key==Key&&!IsUI(M.ActionName)){
            Settings->RemoveActionMapping(M,false);Settings->AddActionMapping(FInputActionKeyMapping(M.ActionName,Previous),false);
        }
    }
    for(const auto& M:Axes){
        if(M.AxisName==Axis&&M.Scale==Scale&&!M.Key.IsGamepadKey())Settings->RemoveAxisMapping(M,false);
        else if(M.Key==Key){Settings->RemoveAxisMapping(M,false);Settings->AddAxisMapping(FInputAxisKeyMapping(M.AxisName,Previous,M.Scale),false);}
    }
    if(Axis.IsNone())Settings->AddActionMapping(FInputActionKeyMapping(Action,Key),false);
    else Settings->AddAxisMapping(FInputAxisKeyMapping(Axis,Key,Scale),false);
    if(Persist)Settings->SaveKeyMappings();return true;
}
