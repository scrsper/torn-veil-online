#include "TVCommonUIWidgets.h"

#include "Blueprint/WidgetTree.h"
#include "CommonInputModeTypes.h"
#include "Components/Overlay.h"
#include "Components/OverlaySlot.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "Input/UIActionBindingHandle.h"

namespace
{
    UTextBlock* Text(UWidgetTree* Tree, const FString& Value, float Size = 18.f)
    {
        UTextBlock* Result = Tree->ConstructWidget<UTextBlock>();
        Result->SetText(FText::FromString(Value));
        Result->SetFont(FSlateFontInfo(FName("Default"), static_cast<int32>(Size)));
        return Result;
    }

    UButton* Button(UWidgetTree* Tree, const FString& Label, float Size = 18.f)
    {
        UButton* Result = Tree->ConstructWidget<UButton>();
        Result->SetIsFocusable(true);
        Result->AddChild(Text(Tree, Label, Size));
        return Result;
    }
}

UTVCommonActivatableWidget::UTVCommonActivatableWidget(const FObjectInitializer& ObjectInitializer)
    : Super(ObjectInitializer)
{
    bIsBackHandler = true;
    bAutoRestoreFocus = true;
    bIsModal = true;
}

bool UTVCommonActivatableWidget::NativeOnHandleBackAction()
{
    DeactivateWidget();
    if (CommandDelegate) CommandDelegate->Broadcast(ETVUICommand::Back, FString(), FString(), INDEX_NONE);
    return true;
}

TOptional<FUIInputConfig> UTVCommonActivatableWidget::GetDesiredInputConfig() const
{
    return FUIInputConfig(ECommonInputMode::Menu, EMouseCaptureMode::NoCapture);
}

void UTVInteractionPromptWidget::NativeConstruct()
{
    Super::NativeConstruct();
    UOverlay* Overlay = WidgetTree->ConstructWidget<UOverlay>();
    WidgetTree->RootWidget = Overlay;
    PromptButton = Button(WidgetTree, TEXT(""));
    PromptText = Cast<UTextBlock>(PromptButton->GetChildAt(0));
    Overlay->AddChild(PromptButton);
    PromptButton->OnClicked.AddDynamic(this, &UTVInteractionPromptWidget::HandleClicked);
}

void UTVInteractionPromptWidget::SetSnapshot(const FTVUISnapshot& InSnapshot)
{
    if (!PromptText) return;
    const FString Label = InSnapshot.FocusedLabel.IsEmpty() ? TEXT("") : FString::Printf(TEXT("[Interact] %s"), *InSnapshot.FocusedLabel);
    PromptText->SetText(FText::FromString(Label));
    SetVisibility(Label.IsEmpty() ? ESlateVisibility::Collapsed : ESlateVisibility::Visible);
}

void UTVInteractionPromptWidget::HandleClicked()
{
    if (CommandDelegate) CommandDelegate->Broadcast(ETVUICommand::Interact, FString(), FString(), INDEX_NONE);
}

void UTVDialogueWidget::NativeConstruct()
{
    Super::NativeConstruct();
    Body = WidgetTree->ConstructWidget<UVerticalBox>();
    WidgetTree->RootWidget = Body;
    Rebuild();
}

void UTVDialogueWidget::SetSnapshot(const FTVUISnapshot& InSnapshot) { Snapshot = InSnapshot; Rebuild(); }

void UTVDialogueWidget::Rebuild()
{
    if (!Body) return;
    Body->ClearChildren();
    Body->AddChildToVerticalBox(Text(WidgetTree, Snapshot.DialogueSpeaker + TEXT(" / ") + Snapshot.DialogueOccupation, 24.f));
    for (const FString& Line : Snapshot.DialogueLines) Body->AddChildToVerticalBox(Text(WidgetTree, Line));
    for (int32 I = 0; I < Snapshot.DialogueOptionLabels.Num(); ++I)
    {
        const FString Id = Snapshot.DialogueOptionIds.IsValidIndex(I) ? Snapshot.DialogueOptionIds[I] : FString();
        AddChoice(I, Id, Snapshot.DialogueOptionLabels[I]);
    }
}

void UTVDialogueWidget::AddChoice(int32 Index, const FString& Id, const FString& Label)
{
    UButton* Choice = Button(WidgetTree, FString::Printf(TEXT("%d  %s"), Index + 1, *Label));
    Choice->OnClicked.AddLambda([this, Index, Id]() { if (CommandDelegate) CommandDelegate->Broadcast(ETVUICommand::DialogueChoice, Id, FString(), Index); });
    Body->AddChildToVerticalBox(Choice);
}

void UTVInventoryWidget::NativeConstruct()
{
    Super::NativeConstruct(); Body = WidgetTree->ConstructWidget<UVerticalBox>(); WidgetTree->RootWidget = Body; Rebuild();
}
void UTVInventoryWidget::SetSnapshot(const FTVUISnapshot& InSnapshot) { Snapshot = InSnapshot; Rebuild(); }
void UTVInventoryWidget::Rebuild()
{
    if (!Body) return; Body->ClearChildren(); Body->AddChildToVerticalBox(Text(WidgetTree, TEXT("Inventory"), 26.f));
    Body->AddChildToVerticalBox(Text(WidgetTree, Snapshot.Vitals));
    for (int32 I=0; I<Snapshot.Inventory.Num(); ++I) AddItem(I, Snapshot.Inventory[I]);
    if (!Snapshot.ContainerId.IsEmpty()) Body->AddChildToVerticalBox(Text(WidgetTree, TEXT("Open container: ") + Snapshot.ContainerName));
}
void UTVInventoryWidget::AddItem(int32 Index, const FTVUIItemRow& Item)
{
    UButton* Entry = Button(WidgetTree, FString::Printf(TEXT("%s  x%.0f  [Drop]"), *Item.Label, Item.Quantity));
    const FString Id = Item.Id; Entry->OnClicked.AddLambda([this, Id, Index]() { if (CommandDelegate) CommandDelegate->Broadcast(ETVUICommand::DropItem, Id, FString(), Index); });
    Body->AddChildToVerticalBox(Entry);
}

void UTVContainerWidget::NativeConstruct()
{
    Super::NativeConstruct(); Body = WidgetTree->ConstructWidget<UVerticalBox>(); WidgetTree->RootWidget = Body; Rebuild();
}
void UTVContainerWidget::SetSnapshot(const FTVUISnapshot& InSnapshot) { Snapshot = InSnapshot; Rebuild(); }
void UTVContainerWidget::Rebuild()
{
    if (!Body) return; Body->ClearChildren(); Body->AddChildToVerticalBox(Text(WidgetTree, Snapshot.ContainerName, 26.f));
    for (int32 I=0; I<Snapshot.Container.Num(); ++I) AddItem(I, Snapshot.Container[I]);
}
void UTVContainerWidget::AddItem(int32 Index, const FTVUIItemRow& Item)
{
    UButton* Entry = Button(WidgetTree, FString::Printf(TEXT("%s  x%.0f  [Transfer]"), *Item.Label, Item.Quantity));
    const FString Id = Item.Id; const FString Container = Snapshot.ContainerId;
    Entry->OnClicked.AddLambda([this, Id, Container, Index]() { if (CommandDelegate) CommandDelegate->Broadcast(ETVUICommand::TransferItem, Id, Container, Index); });
    Body->AddChildToVerticalBox(Entry);
}

void UTVMenuWidget::NativeConstruct()
{
    Super::NativeConstruct();
    UVerticalBox* Body = WidgetTree->ConstructWidget<UVerticalBox>(); WidgetTree->RootWidget = Body;
    Body->AddChildToVerticalBox(Text(WidgetTree, TEXT("Torn Veil"), 28.f));
    ResumeButton = Button(WidgetTree, TEXT("Resume")); Body->AddChildToVerticalBox(ResumeButton); ResumeButton->OnClicked.AddDynamic(this, &UTVMenuWidget::Resume);
}
void UTVMenuWidget::Resume() { DeactivateWidget(); if (CommandDelegate) CommandDelegate->Broadcast(ETVUICommand::Back, FString(), FString(), INDEX_NONE); }

UTVPlayerShellWidget::UTVPlayerShellWidget(const FObjectInitializer& ObjectInitializer) : Super(ObjectInitializer) { bSupportsActivationFocus = true; }

void UTVPlayerShellWidget::NativeConstruct()
{
    Super::NativeConstruct();
    RootOverlay = WidgetTree->ConstructWidget<UOverlay>(); WidgetTree->RootWidget = RootOverlay;
    Prompt = WidgetTree->ConstructWidget<UTVInteractionPromptWidget>(); Prompt->SetCommandDelegate(CommandSink ? CommandSink : &CommandRequested); RootOverlay->AddChild(Prompt);
    ModalStack = WidgetTree->ConstructWidget<UCommonActivatableWidgetStack>(); RootOverlay->AddChild(ModalStack);
    SetSnapshot(Snapshot);
}

void UTVPlayerShellWidget::SetCommandDelegate(FTVUICommandRequested* InDelegate)
{
    CommandSink = InDelegate;
    if (Prompt) Prompt->SetCommandDelegate(CommandSink ? CommandSink : &CommandRequested);
    if (UCommonActivatableWidget* Active = ModalStack ? ModalStack->GetActiveWidget() : nullptr)
        if (UTVCommonActivatableWidget* TV = Cast<UTVCommonActivatableWidget>(Active)) TV->SetCommandDelegate(CommandSink ? CommandSink : &CommandRequested);
}

void UTVPlayerShellWidget::SetSnapshot(const FTVUISnapshot& InSnapshot)
{
    const bool bRevisionChanged = LastSnapshotRevision != InSnapshot.Revision;
    Snapshot = InSnapshot; LastSnapshotRevision = InSnapshot.Revision;
    if (Prompt) Prompt->SetSnapshot(Snapshot);
    if (bRevisionChanged && Snapshot.bDialogueOpen && (!ModalStack || !Cast<UTVDialogueWidget>(ModalStack->GetActiveWidget()))) OpenDialogue();
    else if (bRevisionChanged && !Snapshot.bDialogueOpen && ModalStack && Cast<UTVDialogueWidget>(ModalStack->GetActiveWidget())) CloseTop();
    RefreshActiveWidget();
}

void UTVPlayerShellWidget::RefreshActiveWidget()
{
    if (!ModalStack) return;
    if (UTVDialogueWidget* D = Cast<UTVDialogueWidget>(ModalStack->GetActiveWidget())) D->SetSnapshot(Snapshot);
    else if (UTVInventoryWidget* I = Cast<UTVInventoryWidget>(ModalStack->GetActiveWidget())) I->SetSnapshot(Snapshot);
    else if (UTVContainerWidget* C = Cast<UTVContainerWidget>(ModalStack->GetActiveWidget())) C->SetSnapshot(Snapshot);
}

void UTVPlayerShellWidget::OpenInventory()
{
    if (!ModalStack) return;
    if (Snapshot.bDialogueOpen) return;
    UTVInventoryWidget* W = ModalStack->AddWidget<UTVInventoryWidget>(UTVInventoryWidget::StaticClass(), [this](UTVInventoryWidget& V) { V.SetSnapshot(Snapshot); V.SetCommandDelegate(CommandSink ? CommandSink : &CommandRequested); });
    if (W) W->ActivateWidget();
}
void UTVPlayerShellWidget::OpenDialogue()
{
    if (!ModalStack) return;
    UTVDialogueWidget* W = ModalStack->AddWidget<UTVDialogueWidget>(UTVDialogueWidget::StaticClass(), [this](UTVDialogueWidget& V) { V.SetSnapshot(Snapshot); V.SetCommandDelegate(CommandSink ? CommandSink : &CommandRequested); });
    if (W) W->ActivateWidget();
}
void UTVPlayerShellWidget::OpenContainer()
{
    if (!ModalStack || Snapshot.ContainerId.IsEmpty()) return;
    UTVContainerWidget* W = ModalStack->AddWidget<UTVContainerWidget>(UTVContainerWidget::StaticClass(), [this](UTVContainerWidget& V) { V.SetSnapshot(Snapshot); V.SetCommandDelegate(CommandSink ? CommandSink : &CommandRequested); });
    if (W) W->ActivateWidget();
}
void UTVPlayerShellWidget::OpenMenu()
{
    if (!ModalStack) return;
    UTVMenuWidget* W = ModalStack->AddWidget<UTVMenuWidget>(UTVMenuWidget::StaticClass(), [this](UTVMenuWidget& V) { V.SetCommandDelegate(CommandSink ? CommandSink : &CommandRequested); });
    if (W) W->ActivateWidget();
}
void UTVPlayerShellWidget::CloseTop() { if (ModalStack && ModalStack->GetActiveWidget()) ModalStack->GetActiveWidget()->DeactivateWidget(); }
bool UTVPlayerShellWidget::HasModalScreen() const { return ModalStack && ModalStack->GetNumWidgets() > 0; }
