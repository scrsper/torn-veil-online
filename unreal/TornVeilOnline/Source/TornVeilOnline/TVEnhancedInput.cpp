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
#include "TVControlSettings.h"

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
        // Mouse deltas are not normalized stick values; clamping them silently changes
        // the established sensitivity. Movement already clamps its combined intent.
        const auto Read=[this,Callback](const FInputActionValue& V){(this->*Callback)(V.Get<float>());};
        Enhanced->BindActionValueLambda(A,ETriggerEvent::Triggered,Read);
        Enhanced->BindActionValueLambda(A,ETriggerEvent::Completed,Read);
        Enhanced->BindActionValueLambda(A,ETriggerEvent::Canceled,Read);
    };
    Axis(TEXT("Forward"),&ATVCharacter::Forward);Axis(TEXT("Right"),&ATVCharacter::Right);
    Axis(TEXT("Turn"),&ATVCharacter::Turn);Axis(TEXT("Look"),&ATVCharacter::Look);Axis(TEXT("Zoom"),&ATVCharacter::Zoom);
    const auto Button=[&](FName Name,auto Callback){auto* A=Action(Name,EInputActionValueType::Boolean);
        TArray<FInputActionKeyMapping> Keys;Settings->GetActionMappingByName(Name,Keys);
        Enhanced->BindAction(A,ETriggerEvent::Started,this,Callback);return A;};
    auto* Sprint=Button(TEXT("Sprint"),&ATVCharacter::SprintOn);
    Enhanced->BindAction(Sprint,ETriggerEvent::Completed,this,&ATVCharacter::SprintOff);Enhanced->BindAction(Sprint,ETriggerEvent::Canceled,this,&ATVCharacter::SprintOff);
    auto* Crouch=Button(TEXT("Crouch"),&ATVCharacter::Duck);
    Enhanced->BindAction(Crouch,ETriggerEvent::Completed,this,&ATVCharacter::ReleaseCrouch);Enhanced->BindAction(Crouch,ETriggerEvent::Canceled,this,&ATVCharacter::ReleaseCrouch);
    Button(TEXT("LockTarget"),&ATVCharacter::SelectTarget);Button(TEXT("SwitchTarget"),&ATVCharacter::SwitchTarget);Button(TEXT("Interact"),&ATVCharacter::Interact);
    Button(TEXT("Inventory"),&ATVCharacter::Inventory);Button(TEXT("PauseMenu"),&ATVCharacter::PauseMenu);
    Button(TEXT("UIBack"),&ATVCharacter::UIBack); // opens menu only; CommonUI owns modal Back
    Button(TEXT("QuickItem"),&ATVCharacter::Consume);
    Button(TEXT("PrimaryAbility"),&ATVCharacter::Hush);Button(TEXT("AbilityWheel"),&ATVCharacter::AbilityWheel);
    Button(TEXT("Journal"),&ATVCharacter::Journal);Button(TEXT("ItemWheel"),&ATVCharacter::Inventory);
    auto* Guard=Button(TEXT("Guard"),&ATVCharacter::GuardOn);
    Enhanced->BindAction(Guard,ETriggerEvent::Completed,this,&ATVCharacter::GuardOff);Enhanced->BindAction(Guard,ETriggerEvent::Canceled,this,&ATVCharacter::GuardOff);
    auto* Focus=Button(TEXT("Focus"),&ATVCharacter::FocusOn);
    Enhanced->BindAction(Focus,ETriggerEvent::Completed,this,&ATVCharacter::FocusOff);Enhanced->BindAction(Focus,ETriggerEvent::Canceled,this,&ATVCharacter::FocusOff);
    Button(TEXT("LightAttack"),&ATVCharacter::Attack);Button(TEXT("HeavyAttack"),&ATVCharacter::LowAttack);Button(TEXT("Dodge"),&ATVCharacter::Dodge);
    Button(TEXT("Inspector"),&ATVCharacter::Inspector);
    Button(TEXT("PracticePassive"),&ATVCharacter::PracticePassive);Button(TEXT("PracticeRepeat"),&ATVCharacter::PracticeRepeat);
    Button(TEXT("PracticeReset"),&ATVCharacter::PracticeReset);Button(TEXT("PracticePhysiology"),&ATVCharacter::PracticePhysiology);
    Button(TEXT("SaveWorld"),&ATVCharacter::SaveWorld);
    Button(TEXT("Mechanisms"),&ATVCharacter::Mechanisms);
    // Optional keyboard shortcuts supplement the ordinary contextual menus.
    Button(TEXT("RestToggle"),&ATVCharacter::RestToggle);
    // Veil meditation (V) and an Iron breakthrough attempt (B): canonical person actions whose
    // requirements the server decides; refusals come back as ordinary results.
    Button(TEXT("Meditate"),&ATVCharacter::Meditate);
    Button(TEXT("Breakthrough"),&ATVCharacter::Breakthrough);
    Button(TEXT("Train"),&ATVCharacter::Train);
    RebuildInputMappings();
    bInputModal=true;RefreshInputContext(false);
}
void ATVCharacter::RebuildInputMappings() {
    if(!GameplayContext)return;
    GameplayContext->UnmapAll();const auto* Settings=GetDefault<UInputSettings>();
    for(const auto& Pair:SemanticActions){
        if(Pair.Value->ValueType==EInputActionValueType::Boolean){
            TArray<FInputActionKeyMapping> Keys;Settings->GetActionMappingByName(Pair.Key,Keys);
            for(const auto& Key:Keys)GameplayContext->MapKey(Pair.Value,Key.Key);
        }else{
            TArray<FInputAxisKeyMapping> Keys;Settings->GetAxisMappingByName(Pair.Key,Keys);
            for(const auto& Key:Keys){
                auto& M=GameplayContext->MapKey(Pair.Value,Key.Key);
                auto* Scale=NewObject<UInputModifierScalar>(GameplayContext);Scale->Scalar=FVector(Key.Scale);M.Modifiers.Add(Scale);
                if(Pair.Key!=TEXT("Zoom")){
                    auto* Control=NewObject<UTVControlModifier>(GameplayContext);Control->bGamepad=Key.Key.IsGamepadKey();
                    Control->bCamera=Pair.Key==TEXT("Turn")||Pair.Key==TEXT("Look");Control->bVertical=Pair.Key==TEXT("Look");M.Modifiers.Add(Control);
                }
            }
        }
    }
    if(auto* PC=Cast<APlayerController>(Controller))if(auto* LP=PC->GetLocalPlayer())if(auto* Inputs=LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>()){
        FModifyContextOptions Options;Options.bIgnoreAllPressedKeysUntilRelease=true;Options.bForceImmediately=true;
        Inputs->RequestRebuildControlMappings(Options);
    }
}
void ATVCharacter::RefreshInputContext(bool Modal) {
    if(!GameplayContext||bInputModal==Modal)return;
    auto* PC=Cast<APlayerController>(Controller);if(!PC||!PC->GetLocalPlayer())return;
    auto* Inputs=PC->GetLocalPlayer()->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>();if(!Inputs)return;
    bInputModal=Modal;LoseFocus();
    FModifyContextOptions Options;Options.bIgnoreAllPressedKeysUntilRelease=true;Options.bForceImmediately=true;
    if(Modal)Inputs->RemoveMappingContext(GameplayContext,Options);else Inputs->AddMappingContext(GameplayContext,0,Options);
}
