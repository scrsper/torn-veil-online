#include "TVCommonUIWidgets.h"
#include "Blueprint/WidgetTree.h"
#include "CommonInputModeTypes.h"
#include "Components/Border.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/Overlay.h"
#include "Components/OverlaySlot.h"
#include "Components/SizeBox.h"
#include "Components/ScrollBox.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Input/UIActionBindingHandle.h"
#include "Blueprint/WidgetLayoutLibrary.h"
#include "Styling/CoreStyle.h"

namespace
{
UTextBlock* MakeText(UWidgetTree* T,const FString& V,int32 S=18){auto* W=T->ConstructWidget<UTextBlock>();W->SetText(FText::FromString(V));FSlateFontInfo Font=FCoreStyle::Get().GetFontStyle(TEXT("NormalFont"));Font.Size=S;W->SetFont(Font);return W;}
UTVUICommandButton* MakeButton(UWidgetTree* T,FTVUICommandRequested* Sink,ETVUICommand C,const FString& P,const FString& S,int32 I,const FString& L){auto* W=T->ConstructWidget<UTVUICommandButton>();W->Configure(Sink,C,P,S,I);W->SetLabel(L);return W;}
UWidget* WrapModal(UWidgetTree* T,UWidget* Content){auto* Overlay=T->ConstructWidget<UOverlay>();auto* Border=T->ConstructWidget<UBorder>();Border->SetPadding(FMargin(24.f));Border->SetBrushColor(FLinearColor(0.025f,0.035f,0.05f,0.96f));auto* Size=T->ConstructWidget<USizeBox>();Size->SetWidthOverride(760.f);Size->SetHeightOverride(620.f);Border->AddChild(Content);Size->AddChild(Border);auto* Slot=Overlay->AddChildToOverlay(Size);Slot->SetHorizontalAlignment(HAlign_Center);Slot->SetVerticalAlignment(VAlign_Center);return Overlay;}
}

void UTVUICommandButton::Configure(FTVUICommandRequested* InSink,ETVUICommand InCommand,const FString& InPrimary,const FString& InSecondary,int32 InIndex){Sink=InSink;Command=InCommand;Primary=InPrimary;Secondary=InSecondary;Index=InIndex;InitIsFocusable(true);OnClicked.RemoveAll(this);OnClicked.AddDynamic(this,&UTVUICommandButton::HandleClicked);}
void UTVUICommandButton::SetLabel(const FString& Label){if(!LabelText){LabelText=NewObject<UTextBlock>(this);SetContent(LabelText);}LabelText->SetText(FText::FromString(Label));}
TSharedRef<SWidget> UTVUICommandButton::RebuildWidget(){if(!GetContent()){LabelText=NewObject<UTextBlock>(this);SetContent(LabelText);}return Super::RebuildWidget();}
void UTVUICommandButton::SynchronizeProperties(){Super::SynchronizeProperties();}
void UTVUICommandButton::HandleClicked(){if(Sink)Sink->Broadcast(Command,Primary,Secondary,Index);}

UTVCommonActivatableWidget::UTVCommonActivatableWidget(const FObjectInitializer& O):Super(O){bIsBackHandler=true;bAutoRestoreFocus=true;bIsModal=true;}
void UTVCommonActivatableWidget::SetCommandDelegate(FTVUICommandRequested* InDelegate){
    CommandDelegate=InDelegate;
    // CommonUI's pooled widget can build before AddWidget's initialization callback.
    // Attach the current sink to existing buttons too, including Empty/Back and Resume.
    if(WidgetTree)WidgetTree->ForEachWidget([&](UWidget* W){if(auto* B=Cast<UTVUICommandButton>(W))B->SetCommandSink(InDelegate);});
}
bool UTVCommonActivatableWidget::NativeOnHandleBackAction(){if(CommandDelegate)CommandDelegate->Broadcast(ETVUICommand::Back,FString(),FString(),INDEX_NONE);else DeactivateWidget();return true;}
FReply UTVCommonActivatableWidget::NativeOnKeyDown(const FGeometry& G,const FKeyEvent& E){const FKey K=E.GetKey();if(K==EKeys::Escape||K==EKeys::Gamepad_FaceButton_Right){NativeOnHandleBackAction();return FReply::Handled();}return Super::NativeOnKeyDown(G,E);}
UWidget* UTVCommonActivatableWidget::NativeGetDesiredFocusTarget() const{return nullptr;}
TOptional<FUIInputConfig> UTVCommonActivatableWidget::GetDesiredInputConfig()const{return FUIInputConfig(ECommonInputMode::Menu,EMouseCaptureMode::NoCapture);}

TSharedRef<SWidget> UTVInteractionPromptWidget::RebuildWidget(){
    Canvas=WidgetTree->ConstructWidget<UCanvasPanel>();WidgetTree->RootWidget=Canvas;
    for(int32 I=0;I<4;++I){auto* Edge=WidgetTree->ConstructWidget<UBorder>();Edge->SetBrushColor(FLinearColor(1.f,.75f,.1f,0.9f));Edge->SetVisibility(ESlateVisibility::Collapsed);FocusEdges.Add(Edge);Canvas->AddChildToCanvas(Edge)->SetZOrder(-1);}
    PromptButton=WidgetTree->ConstructWidget<UTVUICommandButton>();PromptButton->Configure(CommandDelegate,ETVUICommand::Interact,FString(),FString(),INDEX_NONE);
    PromptText=MakeText(WidgetTree,TEXT(""));PromptButton->AddChild(PromptText);
    auto* PromptSlot=Canvas->AddChildToCanvas(PromptButton);PromptSlot->SetAnchors(FAnchors(.5f,1.f));PromptSlot->SetAlignment(FVector2D(.5f,1.f));PromptSlot->SetAutoSize(true);PromptSlot->SetPosition(FVector2D(0.f,-72.f));
    ActionGlyph=WidgetTree->ConstructWidget<UCommonActionWidget>();auto* GlyphSlot=Canvas->AddChildToCanvas(ActionGlyph);GlyphSlot->SetAnchors(FAnchors(.5f,1.f));GlyphSlot->SetAlignment(FVector2D(0.f,1.f));GlyphSlot->SetAutoSize(true);GlyphSlot->SetPosition(FVector2D(180.f,-72.f));
    return Super::RebuildWidget();
}
void UTVInteractionPromptWidget::NativeConstruct(){Super::NativeConstruct();}
void UTVInteractionPromptWidget::SetInteractAction(UInputAction* InAction){InteractAction=InAction;if(ActionGlyph)ActionGlyph->SetEnhancedInputAction(InAction);}
void UTVInteractionPromptWidget::SetSnapshot(const FTVUISnapshot& S){if(!PromptText)return;const FString L=S.FocusedLabel.IsEmpty()?FString():FString::Printf(TEXT("[E / A] %s"),*S.FocusedLabel);PromptText->SetText(FText::FromString(L));SetVisibility(L.IsEmpty()?ESlateVisibility::Collapsed:ESlateVisibility::Visible);if(auto* B=Cast<UTVUICommandButton>(PromptButton))B->Configure(CommandDelegate,ETVUICommand::Interact,S.FocusedTargetId,S.FocusedActionId,INDEX_NONE);if(ActionGlyph)ActionGlyph->SetVisibility(InteractAction&&ActionGlyph->GetIcon().GetResourceObject()?ESlateVisibility::Visible:ESlateVisibility::Collapsed);const float Scale=FMath::Max(0.01f,UWidgetLayoutLibrary::GetViewportScale(this));for(UBorder* Edge:FocusEdges)if(Edge){Edge->SetVisibility(S.FocusedBounds.bHasFocusBounds?ESlateVisibility::Visible:ESlateVisibility::Collapsed);}if(S.FocusedBounds.bHasFocusBounds){const FVector2D Min=S.FocusedBounds.BoundsPixels.Min/Scale;const FVector2D Max=S.FocusedBounds.BoundsPixels.Max/Scale;const FVector2D Size=Max-Min;const float T=2.f;const FVector2D Positions[4]={Min,FVector2D(Min.X,Max.Y-T),FVector2D(Min.X,Min.Y),FVector2D(Max.X-T,Min.Y)};const FVector2D Sizes[4]={FVector2D(Size.X,T),FVector2D(Size.X,T),FVector2D(T,Size.Y),FVector2D(T,Size.Y)};for(int32 I=0;I<4&&I<FocusEdges.Num();++I)if(auto* EdgeSlot=Cast<UCanvasPanelSlot>(FocusEdges[I]->Slot)){EdgeSlot->SetPosition(Positions[I]);EdgeSlot->SetSize(Sizes[I]);}}}

TSharedRef<SWidget> UTVDialogueWidget::RebuildWidget(){Body=WidgetTree->ConstructWidget<UVerticalBox>();auto* Scroll=WidgetTree->ConstructWidget<UScrollBox>();Scroll->AddChild(Body);WidgetTree->RootWidget=WrapModal(WidgetTree,Scroll);Rebuild();return Super::RebuildWidget();}
FReply UTVDialogueWidget::NativeOnKeyDown(const FGeometry& G,const FKeyEvent& E){
    const TArray<FKey> Keys={EKeys::One,EKeys::Two,EKeys::Three,EKeys::Four,EKeys::Five,EKeys::Six,EKeys::Seven,EKeys::Eight,EKeys::Nine};
    const TArray<FKey> PadKeys={EKeys::NumPadOne,EKeys::NumPadTwo,EKeys::NumPadThree,EKeys::NumPadFour,EKeys::NumPadFive,EKeys::NumPadSix,EKeys::NumPadSeven,EKeys::NumPadEight,EKeys::NumPadNine};
    int32 I=Keys.IndexOfByKey(E.GetKey());if(I==INDEX_NONE)I=PadKeys.IndexOfByKey(E.GetKey());
    if(Snapshot.DialogueOptionIds.IsValidIndex(I)){
        if(!E.IsRepeat()&&CommandDelegate)CommandDelegate->Broadcast(ETVUICommand::DialogueChoice,Snapshot.DialogueOptionIds[I],FString(),I);
        return FReply::Handled();
    }
    return Super::NativeOnKeyDown(G,E);
}
void UTVDialogueWidget::NativeConstruct(){Super::NativeConstruct();}
void UTVDialogueWidget::SetSnapshot(const FTVUISnapshot& S){Snapshot=S;Rebuild();}
void UTVDialogueWidget::Rebuild(){if(!Body)return;if(!SpeakerText||ChoiceButtons.Num()!=Snapshot.DialogueOptionLabels.Num()||LineTexts.Num()!=Snapshot.DialogueLines.Num()){Body->ClearChildren();ChoiceButtons.Reset();LineTexts.Reset();SpeakerText=MakeText(WidgetTree,Snapshot.DialogueSpeaker+(Snapshot.DialogueOccupation.IsEmpty()?FString():TEXT(" / ")+Snapshot.DialogueOccupation),24);Body->AddChildToVerticalBox(SpeakerText);for(const FString& L:Snapshot.DialogueLines){auto* T=MakeText(WidgetTree,L);T->SetAutoWrapText(true);LineTexts.Add(T);Body->AddChildToVerticalBox(T);}for(int32 I=0;I<Snapshot.DialogueOptionLabels.Num();++I)AddChoice(I,Snapshot.DialogueOptionIds.IsValidIndex(I)?Snapshot.DialogueOptionIds[I]:FString(),Snapshot.DialogueOptionLabels[I]);Body->AddChildToVerticalBox(MakeButton(WidgetTree,CommandDelegate,ETVUICommand::Back,FString(),FString(),INDEX_NONE,TEXT("Close conversation  [Esc / B]")));}else{SpeakerText->SetText(FText::FromString(Snapshot.DialogueSpeaker+(Snapshot.DialogueOccupation.IsEmpty()?FString():TEXT(" / ")+Snapshot.DialogueOccupation)));for(int32 I=0;I<LineTexts.Num();++I)LineTexts[I]->SetText(FText::FromString(Snapshot.DialogueLines[I]));}for(int32 I=0;I<ChoiceButtons.Num();++I){ChoiceButtons[I]->Configure(CommandDelegate,ETVUICommand::DialogueChoice,Snapshot.DialogueOptionIds.IsValidIndex(I)?Snapshot.DialogueOptionIds[I]:FString(),FString(),I);ChoiceButtons[I]->SetLabel(FString::Printf(TEXT("%d  %s"),I+1,*Snapshot.DialogueOptionLabels[I]));}}
void UTVDialogueWidget::AddChoice(int32 I,const FString& Id,const FString& Label){auto* W=MakeButton(WidgetTree,CommandDelegate,ETVUICommand::DialogueChoice,Id,FString(),I,Label);ChoiceButtons.Add(W);Body->AddChildToVerticalBox(W);}
UWidget* UTVDialogueWidget::NativeGetDesiredFocusTarget() const{return ChoiceButtons.Num()?ChoiceButtons[0]:nullptr;}

TSharedRef<SWidget> UTVInventoryWidget::RebuildWidget(){Body=WidgetTree->ConstructWidget<UVerticalBox>();WidgetTree->RootWidget=WrapModal(WidgetTree,Body);Rebuild();return Super::RebuildWidget();}
void UTVInventoryWidget::NativeConstruct(){Super::NativeConstruct();}
void UTVInventoryWidget::SetSnapshot(const FTVUISnapshot& S){Snapshot=S;Rebuild();}
void UTVInventoryWidget::Rebuild(){if(!Body)return;if(!bBuilt||ItemButtons.Num()!=Snapshot.Inventory.Num()){Body->ClearChildren();ItemButtons.Reset();EatButtons.Reset();Body->AddChildToVerticalBox(MakeText(WidgetTree,TEXT("Inventory"),26));Body->AddChildToVerticalBox(MakeText(WidgetTree,Snapshot.Vitals));if(Snapshot.Inventory.IsEmpty())Body->AddChildToVerticalBox(MakeText(WidgetTree,TEXT("Empty")));for(int32 I=0;I<Snapshot.Inventory.Num();++I)AddItem(I,Snapshot.Inventory[I]);BackButton=MakeButton(WidgetTree,CommandDelegate,ETVUICommand::Back,FString(),FString(),INDEX_NONE,TEXT("Back  [Esc / B]"));Body->AddChildToVerticalBox(BackButton);bBuilt=true;if(UWidget* Focus=NativeGetDesiredFocusTarget())Focus->SetFocus();}for(int32 I=0;I<ItemButtons.Num();++I){const auto& Item=Snapshot.Inventory[I];ItemButtons[I]->Configure(CommandDelegate,ETVUICommand::DropItem,Item.Id,FString(),I);ItemButtons[I]->SetLabel(FString::Printf(TEXT("%s  [Drop]"),*Item.Label));EatButtons[I]->Configure(CommandDelegate,ETVUICommand::EatItem,Item.Id,FString(),I);EatButtons[I]->SetLabel(TEXT("Eat"));}}
void UTVInventoryWidget::AddItem(int32 I,const FTVUIItemRow& Item){auto* W=MakeButton(WidgetTree,CommandDelegate,ETVUICommand::DropItem,Item.Id,FString(),I,FString::Printf(TEXT("%s  [Drop]"),*Item.Label));auto* E=MakeButton(WidgetTree,CommandDelegate,ETVUICommand::EatItem,Item.Id,FString(),I,TEXT("Eat"));ItemButtons.Add(W);EatButtons.Add(E);Body->AddChildToVerticalBox(W);Body->AddChildToVerticalBox(E);}
UWidget* UTVInventoryWidget::NativeGetDesiredFocusTarget() const{return ItemButtons.Num()?ItemButtons[0]:BackButton;}

TSharedRef<SWidget> UTVContainerWidget::RebuildWidget(){Body=WidgetTree->ConstructWidget<UVerticalBox>();WidgetTree->RootWidget=WrapModal(WidgetTree,Body);Rebuild();return Super::RebuildWidget();}
void UTVContainerWidget::NativeConstruct(){Super::NativeConstruct();}
void UTVContainerWidget::SetSnapshot(const FTVUISnapshot& S){Snapshot=S;Rebuild();}
void UTVContainerWidget::Rebuild(){if(!Body)return;const int32 InventoryRows=Snapshot.Inventory.Num(),ContainerRows=Snapshot.Container.Num();if(BuiltInventoryRows!=InventoryRows||BuiltContainerRows!=ContainerRows){Body->ClearChildren();ItemButtons.Reset();Body->AddChildToVerticalBox(MakeText(WidgetTree,Snapshot.ContainerName,26));Body->AddChildToVerticalBox(MakeText(WidgetTree,TEXT("Your inventory"),20));if(Snapshot.Inventory.IsEmpty())Body->AddChildToVerticalBox(MakeText(WidgetTree,TEXT("Empty")));for(int32 I=0;I<InventoryRows;++I){const auto& Item=Snapshot.Inventory[I];auto* W=MakeButton(WidgetTree,CommandDelegate,ETVUICommand::TransferItemToContainer,Item.Id,Snapshot.ContainerId,I,FString::Printf(TEXT("%s  [Store]"),*Item.Label));ItemButtons.Add(W);Body->AddChildToVerticalBox(W);}Body->AddChildToVerticalBox(MakeText(WidgetTree,TEXT("Container"),20));if(Snapshot.Container.IsEmpty())Body->AddChildToVerticalBox(MakeText(WidgetTree,TEXT("Empty")));for(int32 I=0;I<ContainerRows;++I)AddItem(I,Snapshot.Container[I]);BackButton=MakeButton(WidgetTree,CommandDelegate,ETVUICommand::Back,FString(),FString(),INDEX_NONE,TEXT("Back  [Esc / B]"));Body->AddChildToVerticalBox(BackButton);BuiltInventoryRows=InventoryRows;BuiltContainerRows=ContainerRows;if(UWidget* Focus=NativeGetDesiredFocusTarget())Focus->SetFocus();}for(int32 I=0;I<InventoryRows;++I){const auto& Item=Snapshot.Inventory[I];ItemButtons[I]->Configure(CommandDelegate,ETVUICommand::TransferItemToContainer,Item.Id,Snapshot.ContainerId,I);ItemButtons[I]->SetLabel(FString::Printf(TEXT("%s  [Store]"),*Item.Label));}int32 O=InventoryRows;for(int32 I=0;I<ContainerRows;++I){const auto& Item=Snapshot.Container[I];ItemButtons[O+I]->Configure(CommandDelegate,ETVUICommand::TransferItemFromContainer,Item.Id,Snapshot.ContainerId,I);ItemButtons[O+I]->SetLabel(FString::Printf(TEXT("%s  [Take]"),*Item.Label));}}
void UTVContainerWidget::AddItem(int32 I,const FTVUIItemRow& Item){auto* W=MakeButton(WidgetTree,CommandDelegate,ETVUICommand::TransferItemFromContainer,Item.Id,Snapshot.ContainerId,I,FString::Printf(TEXT("%s  [Take]"),*Item.Label));ItemButtons.Add(W);Body->AddChildToVerticalBox(W);}
UWidget* UTVContainerWidget::NativeGetDesiredFocusTarget() const{return ItemButtons.Num()?ItemButtons[0]:BackButton;}

TSharedRef<SWidget> UTVMenuWidget::RebuildWidget(){auto* Body=WidgetTree->ConstructWidget<UVerticalBox>();Body->AddChildToVerticalBox(MakeText(WidgetTree,TEXT("Torn Veil"),28));ResumeButton=MakeButton(WidgetTree,CommandDelegate,ETVUICommand::Back,FString(),FString(),INDEX_NONE,TEXT("Resume  [Esc / B]"));Body->AddChildToVerticalBox(ResumeButton);Body->AddChildToVerticalBox(MakeButton(WidgetTree,CommandDelegate,ETVUICommand::SaveWorld,FString(),FString(),INDEX_NONE,TEXT("Save world")));WidgetTree->RootWidget=WrapModal(WidgetTree,Body);return Super::RebuildWidget();}
void UTVMenuWidget::NativeConstruct(){Super::NativeConstruct();}
void UTVMenuWidget::Resume(){DeactivateWidget();if(CommandDelegate)CommandDelegate->Broadcast(ETVUICommand::Back,FString(),FString(),INDEX_NONE);}
UWidget* UTVMenuWidget::NativeGetDesiredFocusTarget() const{return ResumeButton;}

UTVPlayerShellWidget::UTVPlayerShellWidget(const FObjectInitializer& O):Super(O){bSupportsActivationFocus=true;bAutoRestoreFocus=true;}
TOptional<FUIInputConfig> UTVPlayerShellWidget::GetDesiredInputConfig()const{return FUIInputConfig(ECommonInputMode::Game,EMouseCaptureMode::CapturePermanently);}
TSharedRef<SWidget> UTVPlayerShellWidget::RebuildWidget(){RootOverlay=WidgetTree->ConstructWidget<UOverlay>();WidgetTree->RootWidget=RootOverlay;Prompt=WidgetTree->ConstructWidget<UTVInteractionPromptWidget>();Prompt->SetCommandDelegate(CommandSink?CommandSink:&CommandRequested);auto* PromptSlot=RootOverlay->AddChildToOverlay(Prompt);PromptSlot->SetHorizontalAlignment(HAlign_Fill);PromptSlot->SetVerticalAlignment(VAlign_Fill);auto* Status=WidgetTree->ConstructWidget<UVerticalBox>();VitalsText=MakeText(WidgetTree,TEXT(""));RestrictionText=MakeText(WidgetTree,TEXT(""));Status->AddChildToVerticalBox(VitalsText);Status->AddChildToVerticalBox(RestrictionText);auto* StatusSlot=RootOverlay->AddChildToOverlay(Status);StatusSlot->SetHorizontalAlignment(HAlign_Left);StatusSlot->SetVerticalAlignment(VAlign_Bottom);StatusSlot->SetPadding(FMargin(24.f,0.f,0.f,24.f));ModalStack=WidgetTree->ConstructWidget<UCommonActivatableWidgetStack>();ModalStack->OnDisplayedWidgetChanged().AddUObject(this,&UTVPlayerShellWidget::HandleDisplayedWidgetChanged);auto* StackSlot=RootOverlay->AddChildToOverlay(ModalStack);StackSlot->SetHorizontalAlignment(HAlign_Fill);StackSlot->SetVerticalAlignment(VAlign_Fill);return Super::RebuildWidget();}
void UTVPlayerShellWidget::NativeConstruct(){Super::NativeConstruct();}
void UTVPlayerShellWidget::SetCommandDelegate(FTVUICommandRequested* In){CommandSink=In;if(Prompt)Prompt->SetCommandDelegate(CommandSink?CommandSink:&CommandRequested);if(auto* A=ModalStack?ModalStack->GetActiveWidget():nullptr)if(auto* W=Cast<UTVCommonActivatableWidget>(A))W->SetCommandDelegate(CommandSink?CommandSink:&CommandRequested);}
void UTVPlayerShellWidget::SetInputActions(UInputAction* I,UInputAction* B){InteractAction=I;BackAction=B;if(Prompt)Prompt->SetInteractAction(I);}
void UTVPlayerShellWidget::HandleDisplayedWidgetChanged(UCommonActivatableWidget* Widget){ModalChanged.Broadcast(Widget!=nullptr);}
void UTVPlayerShellWidget::SetSnapshot(const FTVUISnapshot& S){Snapshot=S;LastSnapshotRevision=S.Revision;if(VitalsText)VitalsText->SetText(FText::FromString(Snapshot.Vitals));if(RestrictionText)RestrictionText->SetText(FText::FromString(Snapshot.Restriction));if(Prompt)Prompt->SetSnapshot(Snapshot);if(!Snapshot.bDialogueOpen&&ModalStack&&Cast<UTVDialogueWidget>(ModalStack->GetActiveWidget()))CloseTop();RefreshActiveWidget();}
void UTVPlayerShellWidget::RefreshActiveWidget(){if(!ModalStack)return;auto* A=ModalStack->GetActiveWidget();if(auto* Dialogue=Cast<UTVDialogueWidget>(A))Dialogue->SetSnapshot(Snapshot);else if(auto* Inventory=Cast<UTVInventoryWidget>(A))Inventory->SetSnapshot(Snapshot);else if(auto* Container=Cast<UTVContainerWidget>(A))Container->SetSnapshot(Snapshot);}
void UTVPlayerShellWidget::OpenInventory(){if(ModalStack)if(auto* W=ModalStack->AddWidget<UTVInventoryWidget>(UTVInventoryWidget::StaticClass(),[this](UTVInventoryWidget& V){V.SetSnapshot(Snapshot);V.SetCommandDelegate(CommandSink?CommandSink:&CommandRequested);}))W->ActivateWidget();}
void UTVPlayerShellWidget::OpenDialogue(){if(ModalStack)if(auto* W=ModalStack->AddWidget<UTVDialogueWidget>(UTVDialogueWidget::StaticClass(),[this](UTVDialogueWidget& V){V.SetSnapshot(Snapshot);V.SetCommandDelegate(CommandSink?CommandSink:&CommandRequested);}))W->ActivateWidget();}
void UTVPlayerShellWidget::OpenContainer(){if(ModalStack&&!Snapshot.ContainerId.IsEmpty())if(auto* W=ModalStack->AddWidget<UTVContainerWidget>(UTVContainerWidget::StaticClass(),[this](UTVContainerWidget& V){V.SetSnapshot(Snapshot);V.SetCommandDelegate(CommandSink?CommandSink:&CommandRequested);}))W->ActivateWidget();}
void UTVPlayerShellWidget::OpenMenu(){if(ModalStack)if(auto* W=ModalStack->AddWidget<UTVMenuWidget>(UTVMenuWidget::StaticClass(),[this](UTVMenuWidget& V){V.SetCommandDelegate(CommandSink?CommandSink:&CommandRequested);}))W->ActivateWidget();}
void UTVPlayerShellWidget::CloseTop(){if(ModalStack&&ModalStack->GetActiveWidget())ModalStack->GetActiveWidget()->DeactivateWidget();}
bool UTVPlayerShellWidget::HasModalScreen()const{return ModalStack&&ModalStack->GetActiveWidget()!=nullptr;}
