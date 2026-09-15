#pragma once

#include "CoreMinimal.h"
#include "CommonActivatableWidget.h"
#include "Widgets/CommonActivatableWidgetContainer.h"
#include "CommonActionWidget.h"
#include "CommonUserWidget.h"
#include "Components/Button.h"
#include "InputAction.h"
#include "TVCommonUIWidgets.generated.h"

UENUM(BlueprintType)
enum class ETVUICommand : uint8
{
    Interact,
    DialogueChoice,
    DropItem,
    TransferItemToContainer,
    TransferItemFromContainer,
    EatItem,
    Back,
    Pause,
};

USTRUCT(BlueprintType)
struct TORNVEILONLINE_API FTVUIItemRow
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly) FString Id;
    UPROPERTY(BlueprintReadOnly) FString Label;
    UPROPERTY(BlueprintReadOnly) double Quantity = 0.0;
};

USTRUCT(BlueprintType)
struct TORNVEILONLINE_API FTVUIFocusBounds
{
    GENERATED_BODY()
    UPROPERTY(BlueprintReadOnly) bool bHasFocusBounds = false;
    UPROPERTY(BlueprintReadOnly) FBox2D BoundsPixels;
};

USTRUCT(BlueprintType)
struct TORNVEILONLINE_API FTVUISnapshot
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly) int32 Revision = 0;
    UPROPERTY(BlueprintReadOnly) FString FocusedLabel;
    UPROPERTY(BlueprintReadOnly) FString FocusedTargetId;
    UPROPERTY(BlueprintReadOnly) FString FocusedActionId;
    UPROPERTY(BlueprintReadOnly) FTVUIFocusBounds FocusedBounds;
    UPROPERTY(BlueprintReadOnly) FString Vitals;
    UPROPERTY(BlueprintReadOnly) FString Restriction;
    UPROPERTY(BlueprintReadOnly) TArray<FTVUIItemRow> Inventory;
    UPROPERTY(BlueprintReadOnly) FString ContainerId;
    UPROPERTY(BlueprintReadOnly) FString ContainerName;
    UPROPERTY(BlueprintReadOnly) TArray<FTVUIItemRow> Container;
    UPROPERTY(BlueprintReadOnly) bool bDialogueOpen = false;
    UPROPERTY(BlueprintReadOnly) FString DialogueSpeaker;
    UPROPERTY(BlueprintReadOnly) FString DialogueOccupation;
    UPROPERTY(BlueprintReadOnly) TArray<FString> DialogueLines;
    UPROPERTY(BlueprintReadOnly) TArray<FString> DialogueOptionIds;
    UPROPERTY(BlueprintReadOnly) TArray<FString> DialogueOptionLabels;
};

DECLARE_MULTICAST_DELEGATE_FourParams(FTVUICommandRequested, ETVUICommand, const FString&, const FString&, int32);
DECLARE_MULTICAST_DELEGATE_OneParam(FTVModalChanged, bool);

UCLASS()
class TORNVEILONLINE_API UTVUICommandButton : public UButton
{
    GENERATED_BODY()
public:
    void Configure(FTVUICommandRequested* InSink, ETVUICommand InCommand, const FString& InPrimary, const FString& InSecondary, int32 InIndex);
    void SetLabel(const FString& Label);
protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;
    virtual void SynchronizeProperties() override;
    UFUNCTION() void HandleClicked();
    FTVUICommandRequested* Sink = nullptr;
    ETVUICommand Command = ETVUICommand::Back;
    FString Primary;
    FString Secondary;
    int32 Index = INDEX_NONE;
    UPROPERTY() class UTextBlock* LabelText = nullptr;
};

UCLASS(Abstract, Blueprintable)
class TORNVEILONLINE_API UTVCommonActivatableWidget : public UCommonActivatableWidget
{
    GENERATED_BODY()
public:
    UTVCommonActivatableWidget(const FObjectInitializer& ObjectInitializer = FObjectInitializer::Get());
    virtual bool NativeOnHandleBackAction() override;
    virtual FReply NativeOnKeyDown(const FGeometry& InGeometry, const FKeyEvent& InKeyEvent) override;
    virtual UWidget* NativeGetDesiredFocusTarget() const override;
    virtual TOptional<FUIInputConfig> GetDesiredInputConfig() const override;
    void SetCommandDelegate(FTVUICommandRequested* InDelegate) { CommandDelegate = InDelegate; }
    void SetBackAction(UInputAction* InAction) { BackAction = InAction; }
protected:
    FTVUICommandRequested* CommandDelegate = nullptr;
    UInputAction* BackAction = nullptr;
};

UCLASS(Blueprintable)
class TORNVEILONLINE_API UTVInteractionPromptWidget : public UCommonUserWidget
{
    GENERATED_BODY()
public:
    void SetSnapshot(const FTVUISnapshot& InSnapshot);
    void SetCommandDelegate(FTVUICommandRequested* InDelegate) { CommandDelegate = InDelegate; }
    void SetInteractAction(UInputAction* InAction);
protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;
    virtual void NativeConstruct() override;
    FTVUICommandRequested* CommandDelegate = nullptr;
    UInputAction* InteractAction = nullptr;
    UPROPERTY() class UCanvasPanel* Canvas = nullptr;
    UPROPERTY() class UBorder* FocusHighlight = nullptr;
    UPROPERTY() TArray<class UBorder*> FocusEdges;
    UPROPERTY() class UCommonActionWidget* ActionGlyph = nullptr;
    UPROPERTY() class UTextBlock* PromptText = nullptr;
    UPROPERTY() UTVUICommandButton* PromptButton = nullptr;
};

UCLASS(Blueprintable)
class TORNVEILONLINE_API UTVDialogueWidget : public UTVCommonActivatableWidget
{
    GENERATED_BODY()
public:
    void SetSnapshot(const FTVUISnapshot& InSnapshot);
protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;
    virtual void NativeConstruct() override;
    virtual UWidget* NativeGetDesiredFocusTarget() const override;
    UPROPERTY() class UVerticalBox* Body = nullptr;
    FTVUISnapshot Snapshot;
    UPROPERTY() class UTextBlock* SpeakerText = nullptr;
    TArray<UTextBlock*> LineTexts;
    void Rebuild();
    void AddChoice(int32 Index, const FString& Id, const FString& Label);
    TArray<UTVUICommandButton*> ChoiceButtons;
    int32 BuiltLineCount = -1;
};

UCLASS(Blueprintable)
class TORNVEILONLINE_API UTVInventoryWidget : public UTVCommonActivatableWidget
{
    GENERATED_BODY()
public:
    void SetSnapshot(const FTVUISnapshot& InSnapshot);
protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;
    virtual void NativeConstruct() override;
    virtual UWidget* NativeGetDesiredFocusTarget() const override;
    UPROPERTY() class UVerticalBox* Body = nullptr;
    FTVUISnapshot Snapshot;
    void Rebuild();
    void AddItem(int32 Index, const FTVUIItemRow& Item);
    TArray<UTVUICommandButton*> ItemButtons;
    TArray<UTVUICommandButton*> EatButtons;
    UTVUICommandButton* BackButton = nullptr;
    bool bBuilt = false;
};

UCLASS(Blueprintable)
class TORNVEILONLINE_API UTVContainerWidget : public UTVCommonActivatableWidget
{
    GENERATED_BODY()
public:
    void SetSnapshot(const FTVUISnapshot& InSnapshot);
protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;
    virtual void NativeConstruct() override;
    virtual UWidget* NativeGetDesiredFocusTarget() const override;
    UPROPERTY() class UVerticalBox* Body = nullptr;
    FTVUISnapshot Snapshot;
    void Rebuild();
    void AddItem(int32 Index, const FTVUIItemRow& Item);
    TArray<UTVUICommandButton*> ItemButtons;
    UTVUICommandButton* BackButton = nullptr;
    int32 BuiltInventoryRows = -1;
    int32 BuiltContainerRows = -1;
};

UCLASS(Blueprintable)
class TORNVEILONLINE_API UTVMenuWidget : public UTVCommonActivatableWidget
{
    GENERATED_BODY()
public:
    void SetCommandDelegate(FTVUICommandRequested* InDelegate) { CommandDelegate = InDelegate; }
protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;
    virtual void NativeConstruct() override;
    virtual UWidget* NativeGetDesiredFocusTarget() const override;
    UPROPERTY() class UButton* ResumeButton = nullptr;
    UFUNCTION() void Resume();
};

UCLASS(Blueprintable)
class TORNVEILONLINE_API UTVPlayerShellWidget : public UCommonActivatableWidget
{
    GENERATED_BODY()
public:
    UTVPlayerShellWidget(const FObjectInitializer& ObjectInitializer = FObjectInitializer::Get());
    virtual TOptional<FUIInputConfig> GetDesiredInputConfig() const override;
    virtual void NativeConstruct() override;
    virtual TSharedRef<SWidget> RebuildWidget() override;
    void SetSnapshot(const FTVUISnapshot& InSnapshot);
    void OpenInventory();
    void OpenDialogue();
    void OpenContainer();
    void OpenMenu();
    void CloseTop();
    bool HasModalScreen() const;
    void SetCommandDelegate(FTVUICommandRequested* InDelegate);
    void SetInputActions(UInputAction* InInteract, UInputAction* InBack);
    FTVUICommandRequested& OnCommand() { return CommandRequested; }
    FTVModalChanged& OnModalChanged() { return ModalChanged; }
protected:
    UPROPERTY() class UOverlay* RootOverlay = nullptr;
    UPROPERTY() UTVInteractionPromptWidget* Prompt = nullptr;
    UPROPERTY() UCommonActivatableWidgetStack* ModalStack = nullptr;
    UPROPERTY() class UTextBlock* VitalsText = nullptr;
    UPROPERTY() class UTextBlock* RestrictionText = nullptr;
    UInputAction* InteractAction = nullptr;
    UInputAction* BackAction = nullptr;
    FTVUISnapshot Snapshot;
    int32 LastSnapshotRevision = INDEX_NONE;
    FTVUICommandRequested CommandRequested;
    FTVModalChanged ModalChanged;
    FTVUICommandRequested* CommandSink = nullptr;
    void RefreshActiveWidget();
    void HandleDisplayedWidgetChanged(UCommonActivatableWidget* Widget);
};
