#include "TVCommonUIWidgets.h"
#include "Components/ScrollBox.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "Blueprint/WidgetTree.h"
#include "Components/TextBlock.h"
#include "CommonInputSettings.h"
#include "ICommonInputModule.h"
#include "Engine/World.h"
#include "Engine/Engine.h"
#include "Engine/LocalPlayer.h"
#include "GameFramework/PlayerController.h"

namespace {
template<class T> T* BuildWidget(APlayerController* Owner) {
    auto* W=CreateWidget<T>(Owner);W->TakeWidget();return W;
}
TArray<UTVUICommandButton*> Buttons(UUserWidget* W) {
    TArray<UTVUICommandButton*> Out;W->WidgetTree->ForEachWidget([&](UWidget* Child){if(auto* B=Cast<UTVUICommandButton>(Child))Out.Add(B);});return Out;
}
}
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVCommonUIProjection,
    "TornVeil.Presentation.CommonUIProjection",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FTVCommonUIProjection::RunTest(const FString&) {
    ICommonInputModule::GetSettings().LoadData();
    auto* World=UWorld::CreateWorld(EWorldType::Game,false);
    auto* PC=World->SpawnActor<APlayerController>();auto* LocalPlayer=NewObject<ULocalPlayer>(GEngine);PC->SetPlayer(LocalPlayer);
    // The isolated world has not begun gameplay; register its controller as ordinary
    // PostInitializeComponents does, so FLocalPlayerContext can resolve it by world.
    World->AddController(PC);
    auto* Prompt=BuildWidget<UTVInteractionPromptWidget>(PC);
    FTVUISnapshot Focus;Focus.FocusedLabel=TEXT("Talk — an unfamiliar person");Prompt->SetSnapshot(Focus);
    const auto PromptButtons=Buttons(Prompt);TestEqual(TEXT("one contextual prompt button"),PromptButtons.Num(),1);
    if(PromptButtons.Num()) {
        auto* Label=Cast<UTextBlock>(PromptButtons[0]->GetContent());
        TestTrue(TEXT("Slate rebuild preserves projected prompt content"),Label&&Label->GetText().ToString().Contains(Focus.FocusedLabel));
    }
    auto* Inventory=BuildWidget<UTVInventoryWidget>(PC);
    FTVUISnapshot S;Inventory->SetSnapshot(S);
    FTVUICommandRequested BackSink;int32 BackCount=0;BackSink.AddLambda([&](ETVUICommand C,const FString&,const FString&,int32){if(C==ETVUICommand::Back)++BackCount;});
    Inventory->SetCommandDelegate(&BackSink);
    TestTrue(TEXT("actual CommonUI activatable screen"),Inventory->IsA<UCommonActivatableWidget>());
    TestEqual(TEXT("empty inventory has a Back button"),Buttons(Inventory).Num(),1);
    if(Buttons(Inventory).Num())Buttons(Inventory)[0]->OnClicked.Broadcast();
    TestEqual(TEXT("Back constructed before delegate attachment still routes once"),BackCount,1);
    auto* Menu=BuildWidget<UTVMenuWidget>(PC);Menu->SetCommandDelegate(&BackSink);
    auto Resume=Buttons(Menu);TestEqual(TEXT("menu exposes progression, settings, saving and session exit"),Resume.Num(),7);
    TArray<FString> Panels;TArray<ETVUICommand> ExitRoutes;FTVUICommandRequested MenuSink;MenuSink.AddLambda([&](ETVUICommand C,const FString& P,const FString&,int32){if(C==ETVUICommand::SignOut||C==ETVUICommand::Quit)ExitRoutes.Add(C);if(C==ETVUICommand::OpenPanel)Panels.Add(P);if(C==ETVUICommand::Back)++BackCount;});Menu->SetCommandDelegate(&MenuSink);
    if(Resume.Num()==7){for(int32 I=1;I<=3;++I)Resume[I]->OnClicked.Broadcast();}
    TestTrue(TEXT("normal progression and settings routes"),Panels==TArray<FString>{TEXT("Journal"),TEXT("Abilities"),TEXT("Settings")});
    if(Resume.Num()==7){Resume[5]->OnClicked.Broadcast();Resume[6]->OnClicked.Broadcast();}
    TestTrue(TEXT("controller focus can reach sign-out and quit"),ExitRoutes==TArray<ETVUICommand>{ETVUICommand::SignOut,ETVUICommand::Quit});
    if(Resume.Num())Resume[0]->OnClicked.Broadcast();
    TestEqual(TEXT("Resume also receives late command sink"),BackCount,2);
    auto* Dialogue=BuildWidget<UTVDialogueWidget>(PC);Dialogue->SetCommandDelegate(&BackSink);
    FTVUISnapshot DialogueState;for(int32 I=0;I<9;++I){DialogueState.DialogueOptionLabels.Add(TEXT("Canonical option"));DialogueState.DialogueOptionIds.Add(FString::FromInt(I));}
    Dialogue->SetSnapshot(DialogueState);auto DialogueButtons=Buttons(Dialogue);
    TestEqual(TEXT("nine dialogue choices cannot displace visible Back"),DialogueButtons.Num(),10);
    if(DialogueButtons.Num()==10)DialogueButtons.Last()->OnClicked.Broadcast();
    TestEqual(TEXT("visible dialogue Back routes semantic close"),BackCount,3);
    FTVUICommandRequested ChoiceSink;FString ChoiceId;int32 ChoiceCount=0;
    ChoiceSink.AddLambda([&](ETVUICommand C,const FString& P,const FString&,int32){if(C==ETVUICommand::DialogueChoice){ChoiceId=P;++ChoiceCount;}});
    Dialogue->SetCommandDelegate(&ChoiceSink);
    Dialogue->NativeOnKeyDown(FGeometry(),FKeyEvent(EKeys::Two,FModifierKeysState(),0,false,0,0));
    TestEqual(TEXT("number shortcut submits the current opaque option"),ChoiceId,FString(TEXT("1")));
    DialogueState.DialogueOptionIds[1]=TEXT("new-revision-option");Dialogue->SetSnapshot(DialogueState);
    Dialogue->NativeOnKeyDown(FGeometry(),FKeyEvent(EKeys::Two,FModifierKeysState(),0,false,0,0));
    TestEqual(TEXT("shortcut follows refreshed dialogue revision"),ChoiceId,FString(TEXT("new-revision-option")));
    Dialogue->NativeOnKeyDown(FGeometry(),FKeyEvent(EKeys::Two,FModifierKeysState(),0,true,0,0));
    TestEqual(TEXT("holding a number cannot select through successive replies"),ChoiceCount,2);
    DialogueState.DialogueOptionLabels.Add(TEXT("Late grounded request"));DialogueState.DialogueOptionIds.Add(TEXT("late-request"));
    DialogueState.DialogueOptionLabels.Add(TEXT("Goodbye"));DialogueState.DialogueOptionIds.Add(TEXT("late-goodbye"));
    Dialogue->SetSnapshot(DialogueState);DialogueButtons=Buttons(Dialogue);
    TestEqual(TEXT("all eleven choices remain present with a separate Back"),DialogueButtons.Num(),12);
    if(DialogueButtons.Num()==12){
        auto* LateLabel=Cast<UTextBlock>(DialogueButtons[9]->GetContent());
        TestTrue(TEXT("late choice has no unsupported numeric shortcut"),LateLabel&&LateLabel->GetText().ToString()==TEXT("Late grounded request"));
        DialogueButtons[9]->OnClicked.Broadcast();
        TestEqual(TEXT("late choice routes its current opaque identity"),ChoiceId,FString(TEXT("late-request")));
    }
    TestNotNull(TEXT("empty inventory has a desired focus target"),static_cast<UTVCommonActivatableWidget*>(Inventory)->NativeGetDesiredFocusTarget());
    Inventory->WidgetTree->ForEachWidget([&](UWidget* W){if(auto* Text=Cast<UTextBlock>(W))TestTrue(TEXT("text has a real font/composite font"),Text->GetFont().FontObject!=nullptr||Text->GetFont().CompositeFont.IsValid());});
    auto* Container=BuildWidget<UTVContainerWidget>(PC);
    FTVUICommandRequested Sink;ETVUICommand Last=ETVUICommand::Back;FString Id;
    Sink.AddLambda([&](ETVUICommand C,const FString& P,const FString&,int32){Last=C;Id=P;});Container->SetCommandDelegate(&Sink);
    S.ContainerId=TEXT("canonical-container");S.ContainerName=TEXT("Chest");
    FTVUIItemRow Row;Row.Id=TEXT("canonical-item");Row.Label=TEXT("Bread x1");S.Inventory.Add(Row);Container->SetSnapshot(S);
    auto Before=Buttons(Container);TestEqual(TEXT("one inventory row plus Back"),Before.Num(),2);if(Before.Num())Before[0]->OnClicked.Broadcast();
    TestEqual(TEXT("inventory partition sends Store"),Last,ETVUICommand::TransferItemToContainer);
    S.Inventory.Empty();S.Container.Add(Row);Container->SetSnapshot(S);
    auto After=Buttons(Container);TestEqual(TEXT("constant total row count rebuilds correct partition"),After.Num(),2);if(After.Num())After[0]->OnClicked.Broadcast();
    TestEqual(TEXT("container partition now sends Take"),Last,ETVUICommand::TransferItemFromContainer);TestEqual(TEXT("opaque item identity preserved"),Id,Row.Id);
    Container->NativeOnHandleBackAction();TestEqual(TEXT("Back routes through single semantic handler"),Last,ETVUICommand::Back);
    auto* Journal=BuildWidget<UTVActionPanelWidget>(PC);Journal->Configure(TEXT("Journal"),FString::ChrN(1200,TEXT('x')));
    const auto JournalSlate=Journal->TakeWidget(); // Keep the native scroll widget alive for this input test.
    auto* Scroll=Cast<UScrollBox>(Journal->WidgetTree->FindWidget(TEXT("ContentScroll")));TestNotNull(TEXT("journal owns a reading scroll surface"),Scroll);
    Journal->NativeOnAnalogValueChanged(FGeometry(),FAnalogInputEvent(EKeys::Gamepad_RightY,FModifierKeysState(),0,false,0,0,-.8f));
    if(Scroll)TestTrue(TEXT("right stick scrolls long journal text independently of button focus"),Scroll->GetScrollOffset()>0);
    Journal->NativeOnKeyDown(FGeometry(),FKeyEvent(EKeys::PageUp,FModifierKeysState(),0,false,0,0));
    if(Scroll)TestEqual(TEXT("page-up can return to the journal heading"),Scroll->GetScrollOffset(),0.f);
    World->DestroyWorld(false);return true;
}
#endif
