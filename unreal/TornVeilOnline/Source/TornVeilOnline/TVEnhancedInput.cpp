#include "TVCharacter.h"
#include "TVBridgeSubsystem.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "InputAction.h"
#include "InputMappingContext.h"
#include "InputModifiers.h"
#include "GameFramework/InputSettings.h"
#include "GameFramework/PlayerController.h"
#include "Engine/LocalPlayer.h"

// Configuration retains the established semantic keys; evaluation, deadzones, accumulation,
// trigger lifecycles and context priority belong to Enhanced Input, not legacy bindings.
void ATVCharacter::SetupEnhancedInput(UInputComponent* Input) {
    auto* Enhanced=CastChecked<UEnhancedInputComponent>(Input);
    GameplayContext=NewObject<UInputMappingContext>(this,TEXT("ExplorationGameplay"));
    const auto* Settings=GetDefault<UInputSettings>();
    const auto Action=[&](FName Name,EInputActionValueType Type){
        auto* A=NewObject<UInputAction>(this,Name);A->ValueType=Type;
        A->AccumulationBehavior=EInputActionAccumulationBehavior::Cumulative;
        SemanticActions.Add(Name,A);return A;
    };
    const auto Axis=[&](FName Name,auto Callback){
        auto* A=Action(Name,EInputActionValueType::Axis1D);
        TArray<FInputAxisKeyMapping> Keys;Settings->GetAxisMappingByName(Name,Keys);
        for(const auto& Key:Keys){auto& M=GameplayContext->MapKey(A,Key.Key);auto* Scale=NewObject<UInputModifierScalar>(GameplayContext);Scale->Scalar=FVector(Key.Scale);M.Modifiers.Add(Scale);
            if(Key.Key.IsGamepadKey()){auto* Dead=NewObject<UInputModifierDeadZone>(GameplayContext);Dead->LowerThreshold=.18;M.Modifiers.Add(Dead);}}
        const auto Read=[this,Callback](const FInputActionValue& V){(this->*Callback)(FMath::Clamp(V.Get<float>(),-1.f,1.f));};
        Enhanced->BindActionValueLambda(A,ETriggerEvent::Triggered,Read);
        Enhanced->BindActionValueLambda(A,ETriggerEvent::Completed,Read);
        Enhanced->BindActionValueLambda(A,ETriggerEvent::Canceled,Read);
    };
    Axis(TEXT("Forward"),&ATVCharacter::Forward);Axis(TEXT("Right"),&ATVCharacter::Right);
    Axis(TEXT("Turn"),&ATVCharacter::Turn);Axis(TEXT("Look"),&ATVCharacter::Look);Axis(TEXT("Zoom"),&ATVCharacter::Zoom);Axis(TEXT("HeavyAttackAxis"),&ATVCharacter::HeavyTrigger);
    const auto Button=[&](FName Name,auto Callback){auto* A=Action(Name,EInputActionValueType::Boolean);
        TArray<FInputActionKeyMapping> Keys;Settings->GetActionMappingByName(Name,Keys);
        for(const auto& Key:Keys)GameplayContext->MapKey(A,Key.Key);
        Enhanced->BindAction(A,ETriggerEvent::Started,this,Callback);return A;};
    auto* Sprint=Button(TEXT("Sprint"),&ATVCharacter::SprintOn);
    Enhanced->BindAction(Sprint,ETriggerEvent::Completed,this,&ATVCharacter::SprintOff);Enhanced->BindAction(Sprint,ETriggerEvent::Canceled,this,&ATVCharacter::SprintOff);
    auto* Crouch=Button(TEXT("Crouch"),&ATVCharacter::Duck);
    Enhanced->BindAction(Crouch,ETriggerEvent::Completed,this,&ATVCharacter::ReleaseCrouch);Enhanced->BindAction(Crouch,ETriggerEvent::Canceled,this,&ATVCharacter::ReleaseCrouch);
    Button(TEXT("Target"),&ATVCharacter::SelectTarget);Button(TEXT("Interact"),&ATVCharacter::Interact);
    Button(TEXT("Inventory"),&ATVCharacter::Inventory);Button(TEXT("PauseMenu"),&ATVCharacter::PauseMenu);
    Button(TEXT("UIBack"),&ATVCharacter::UIBack); // opens menu only; CommonUI owns modal Back
    Button(TEXT("Consume"),&ATVCharacter::Consume);Button(TEXT("Drop"),&ATVCharacter::Drop);
    Button(TEXT("LightAttack"),&ATVCharacter::Attack);Button(TEXT("HeavyAttack"),&ATVCharacter::LowAttack);Button(TEXT("Dodge"),&ATVCharacter::Dodge);
    Button(TEXT("Inspector"),&ATVCharacter::Inspector);
    Button(TEXT("PracticePassive"),&ATVCharacter::PracticePassive);Button(TEXT("PracticeRepeat"),&ATVCharacter::PracticeRepeat);
    Button(TEXT("PracticeReset"),&ATVCharacter::PracticeReset);Button(TEXT("PracticePhysiology"),&ATVCharacter::PracticePhysiology);
    GameplayContext->MapKey(Button(TEXT("SaveWorld"),&ATVCharacter::SaveWorld),EKeys::F5);
    GameplayContext->MapKey(Button(TEXT("Mechanisms"),&ATVCharacter::Mechanisms),EKeys::M);
    bInputModal=true;RefreshInputContext(false);
}
void ATVCharacter::RefreshInputContext(bool Modal) {
    if(!GameplayContext||bInputModal==Modal)return;
    auto* PC=Cast<APlayerController>(Controller);if(!PC||!PC->GetLocalPlayer())return;
    auto* Inputs=PC->GetLocalPlayer()->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>();if(!Inputs)return;
    bInputModal=Modal;LoseFocus();
    FModifyContextOptions Options;Options.bIgnoreAllPressedKeysUntilRelease=true;Options.bForceImmediately=true;
    if(Modal)Inputs->RemoveMappingContext(GameplayContext,Options);else Inputs->AddMappingContext(GameplayContext,0,Options);
}
