#include "TVCommonUIWidgets.h"
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
    auto Resume=Buttons(Menu);TestEqual(TEXT("menu has Resume and canonical Save"),Resume.Num(),2);
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
    World->DestroyWorld(false);return true;
}
#endif
