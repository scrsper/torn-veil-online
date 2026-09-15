#pragma once

#include "CoreMinimal.h"
#include "CommonActivatableWidget.h"
#include "CommonActivatableWidgetContainer.h"
#include "CommonActionWidget.h"
#include "CommonUserWidget.h"
#include "Components/Button.h"
#include "TVCommonUIWidgets.generated.h"

UENUM(BlueprintType)
enum class ETVUICommand : uint8
{
    Interact,
    DialogueChoice,
    DropItem,
    TransferItem,
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
struct TORNVEILONLINE_API FTVUISnapshot
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly) int32 Revision = 0;
    UPROPERTY(BlueprintReadOnly) FString FocusedLabel;
    UPROPERTY(BlueprintReadOnly) FString FocusedTargetId;
    UPROPERTY(BlueprintReadOnly) FString FocusedActionId;
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

UCLASS(Abstract, Blueprintable)
class TORNVEILONLINE_API UTVCommonActivatableWidget : public UCommonActivatableWidget
{
    GENERATED_BODY()
public:
    UTVCommonActivatableWidget(const FObjectInitializer& ObjectInitializer = FObjectInitializer::Get());
    virtual bool NativeOnHandleBackAction() override;
    virtual TOptional<FUIInputConfig> GetDesiredInputConfig() const override;
    void SetCommandDelegate(FTVUICommandRequested* InDelegate) { CommandDelegate = InDelegate; }
protected:
    FTVUICommandRequested* CommandDelegate = nullptr;
};

UCLASS(Blueprintable)
class TORNVEILONLINE_API UTVInteractionPromptWidget : public UCommonUserWidget
{
    GENERATED_BODY()
public:
    void SetSnapshot(const FTVUISnapshot& InSnapshot);
    void SetCommandDelegate(FTVUICommandRequested* InDelegate) { CommandDelegate = InDelegate; }
protected:
    virtual void NativeConstruct() override;
    FTVUICommandRequested* CommandDelegate = nullptr;
    UPROPERTY() class UTextBlock* PromptText = nullptr;
    UPROPERTY() class UButton* PromptButton = nullptr;
    UFUNCTION() void HandleClicked();
};

UCLASS(Blueprintable)
class TORNVEILONLINE_API UTVDialogueWidget : public UTVCommonActivatableWidget
{
    GENERATED_BODY()
public:
    void SetSnapshot(const FTVUISnapshot& InSnapshot);
protected:
    virtual void NativeConstruct() override;
    UPROPERTY() class UVerticalBox* Body = nullptr;
    FTVUISnapshot Snapshot;
    void Rebuild();
    void AddChoice(int32 Index, const FString& Id, const FString& Label);
};

UCLASS(Blueprintable)
class TORNVEILONLINE_API UTVInventoryWidget : public UTVCommonActivatableWidget
{
    GENERATED_BODY()
public:
    void SetSnapshot(const FTVUISnapshot& InSnapshot);
protected:
    virtual void NativeConstruct() override;
    UPROPERTY() class UVerticalBox* Body = nullptr;
    FTVUISnapshot Snapshot;
    void Rebuild();
    void AddItem(int32 Index, const FTVUIItemRow& Item);
};

UCLASS(Blueprintable)
class TORNVEILONLINE_API UTVContainerWidget : public UTVCommonActivatableWidget
{
    GENERATED_BODY()
public:
    void SetSnapshot(const FTVUISnapshot& InSnapshot);
protected:
    virtual void NativeConstruct() override;
    UPROPERTY() class UVerticalBox* Body = nullptr;
    FTVUISnapshot Snapshot;
    void Rebuild();
    void AddItem(int32 Index, const FTVUIItemRow& Item);
};

UCLASS(Blueprintable)
class TORNVEILONLINE_API UTVMenuWidget : public UTVCommonActivatableWidget
{
    GENERATED_BODY()
public:
    void SetCommandDelegate(FTVUICommandRequested* InDelegate) { CommandDelegate = InDelegate; }
protected:
    virtual void NativeConstruct() override;
    UPROPERTY() class UButton* ResumeButton = nullptr;
    UFUNCTION() void Resume();
};

UCLASS(Blueprintable)
class TORNVEILONLINE_API UTVPlayerShellWidget : public UCommonActivatableWidget
{
    GENERATED_BODY()
public:
    UTVPlayerShellWidget(const FObjectInitializer& ObjectInitializer = FObjectInitializer::Get());
    virtual void NativeConstruct() override;
    void SetSnapshot(const FTVUISnapshot& InSnapshot);
    void OpenInventory();
    void OpenDialogue();
    void OpenContainer();
    void OpenMenu();
    void CloseTop();
    bool HasModalScreen() const;
    void SetCommandDelegate(FTVUICommandRequested* InDelegate);
    FTVUICommandRequested& OnCommand() { return CommandRequested; }
protected:
    UPROPERTY() class UOverlay* RootOverlay = nullptr;
    UPROPERTY() UTVInteractionPromptWidget* Prompt = nullptr;
    UPROPERTY() UCommonActivatableWidgetStack* ModalStack = nullptr;
    FTVUISnapshot Snapshot;
    int32 LastSnapshotRevision = INDEX_NONE;
    FTVUICommandRequested CommandRequested;
    FTVUICommandRequested* CommandSink = nullptr;
    void RefreshActiveWidget();
};
