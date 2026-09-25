#pragma once
#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "TVClientConfig.h"
#include "TVSignInWidget.generated.h"

DECLARE_DELEGATE_OneParam(FTVSignInSubmitted, const FTVClientConfig&);

/**
 * First-run and recovery screen: server address, account, token, and whether to continue the
 * account's character or begin a new one. It only edits the local client configuration; the
 * server decides who may connect and which characters an account owns.
 */
UCLASS()
class TORNVEILONLINE_API UTVSignInWidget : public UUserWidget
{
    GENERATED_BODY()
public:
    void Prepare(const FTVClientConfig& Current, const FString& Message, bool bOfferNewOnly);
    void SetMessage(const FString& Message) { Message_ = Message; }
    FTVSignInSubmitted OnSubmitted;
    void FocusFirstControl();
protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;
    virtual void NativeConstruct() override;
    virtual FReply NativeOnPreviewKeyDown(const FGeometry&,const FKeyEvent&) override;
private:
    void Submit(bool bNewCharacter);
    void OpenKeyboard(TSharedPtr<class SEditableTextBox> Field);
    void CloseKeyboard();
    TSharedPtr<SWidget> FirstFieldButton,FirstKeyboardButton;
    TSharedPtr<class SEditableTextBox> KeyboardTarget;
    bool bKeyboardOpen=false,bUpperCase=false;
    FTVClientConfig Config;
    FString Message_;
    bool bNewOnly = false;
    bool bMale = false;
    TSharedPtr<class SEditableTextBox> ServerBox, AccountBox, TokenBox, NameBox;
};
