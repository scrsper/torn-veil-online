#include "TVControlSettings.h"
#include "GameFramework/InputSettings.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVSemanticControls,"TornVeil.Presentation.SemanticControls",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FTVSemanticControls::RunTest(const FString&){
    TestEqual(TEXT("configured dead zone removes drift"),UTVControlSettings::Stick(.1f,.18f),0.f);
    const float Walk=UTVControlSettings::Stick(.3f,.18f),Jog=UTVControlSettings::Stick(.8f,.18f);
    TestTrue(TEXT("analog walk to jog is continuous"),Walk>0&&Walk<Jog&&Jog<1);
    TestEqual(TEXT("full stick remains full speed"),UTVControlSettings::Stick(1,.18f),1.f);
    TestEqual(TEXT("signed movement"),UTVControlSettings::Stick(-1,.18f),-1.f);
    TestEqual(TEXT("DualSense cross"),UTVControlSettings::KeyGlyph(EKeys::Gamepad_FaceButton_Bottom,true),FString(TEXT("Cross ×")));
    TestEqual(TEXT("Xbox A"),UTVControlSettings::KeyGlyph(EKeys::Gamepad_FaceButton_Bottom,false),FString(TEXT("A")));
    TestEqual(TEXT("DualSense guard"),UTVControlSettings::KeyGlyph(EKeys::Gamepad_LeftShoulder,true),FString(TEXT("L1")));
    auto* Settings=NewObject<UInputSettings>();
    const auto OriginalActions=Settings->GetActionMappings();const auto OriginalAxes=Settings->GetAxisMappings();
    for(const auto& M:OriginalActions)Settings->RemoveActionMapping(M,false);
    for(const auto& M:OriginalAxes)Settings->RemoveAxisMapping(M,false);
    Settings->AddAxisMapping(FInputAxisKeyMapping(TEXT("Forward"),EKeys::W,1),false);
    Settings->AddActionMapping(FInputActionKeyMapping(TEXT("Interact"),EKeys::E),false);
    Settings->AddActionMapping(FInputActionKeyMapping(TEXT("Interact"),EKeys::Gamepad_FaceButton_Bottom),false);
    Settings->AddActionMapping(FInputActionKeyMapping(TEXT("Guard"),EKeys::RightMouseButton),false);
    TestTrue(TEXT("keyboard action can exchange with movement"),UTVControlSettings::Rebind(Settings,TEXT("Interact"),EKeys::W,false));
    TArray<FInputAxisKeyMapping> Axes;Settings->GetAxisMappingByName(TEXT("Forward"),Axes);
    TestTrue(TEXT("movement stays bound after collision"),Axes.ContainsByPredicate([](const auto& M){return M.Key==EKeys::E&&M.Scale==1;}));
    TArray<FInputActionKeyMapping> Actions;Settings->GetActionMappingByName(TEXT("Interact"),Actions);
    TestTrue(TEXT("controller binding preserved during keyboard edit"),Actions.ContainsByPredicate([](const auto& M){return M.Key==EKeys::Gamepad_FaceButton_Bottom;}));
    TestFalse(TEXT("escape always provides recovery from menus"),UTVControlSettings::Rebind(Settings,TEXT("Guard"),EKeys::Escape,false));
    TestFalse(TEXT("analog stick cannot become a digital action"),UTVControlSettings::Rebind(Settings,TEXT("Guard"),EKeys::Gamepad_LeftX,false));
    return true;
}
#endif
