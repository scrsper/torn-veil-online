#include "TVSignInWidget.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SCheckBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Text/STextBlock.h"
#include "Widgets/SBoxPanel.h"
#include "Kismet/KismetSystemLibrary.h"

void UTVSignInWidget::Prepare(const FTVClientConfig& Current, const FString& Message, bool bOfferNewOnly)
{
    Config = Current; Message_ = Message; bNewOnly = bOfferNewOnly; bMale = Current.NewSex == TEXT("m");
    if (ServerBox) { ServerBox->SetText(FText::FromString(Config.Server)); AccountBox->SetText(FText::FromString(Config.Account)); TokenBox->SetText(FText::FromString(Config.Token)); NameBox->SetText(FText::FromString(Config.NewName)); }
}

void UTVSignInWidget::Submit(bool bNewCharacter)
{
    Config.Server = ServerBox->GetText().ToString().TrimStartAndEnd();
    Config.Account = AccountBox->GetText().ToString().TrimStartAndEnd().ToLower();
    Config.Token = TokenBox->GetText().ToString().TrimStartAndEnd();
    Config.NewName = NameBox->GetText().ToString().TrimStartAndEnd();
    Config.NewSex = bMale ? TEXT("m") : TEXT("f");
    if (Config.Server.IsEmpty() || Config.Account.IsEmpty() || Config.Token.IsEmpty()) { Message_ = TEXT("Server, account and token are all required."); return; }
    if (bNewCharacter && Config.NewName.Len() < 3) { Message_ = TEXT("Give your new character a name (3–32 letters)."); return; }
    Config.Character = bNewCharacter ? TEXT("new") : TEXT("auto");
    Message_ = TEXT("Connecting…");
    OnSubmitted.ExecuteIfBound(Config);
}

TSharedRef<SWidget> UTVSignInWidget::RebuildWidget()
{
    const FSlateFontInfo Title = FCoreStyle::GetDefaultFontStyle("Bold", 22), Body = FCoreStyle::GetDefaultFontStyle("Regular", 13);
    auto Label = [&](const TCHAR* Text) { return SNew(STextBlock).Text(FText::FromString(Text)).Font(Body).ColorAndOpacity(FLinearColor(0.85f, 0.82f, 0.74f)); };
    auto Field = [&](TSharedPtr<SEditableTextBox>& Out, const FString& Value, const TCHAR* Hint, bool bPassword) {
        return SAssignNew(Out, SEditableTextBox).Text(FText::FromString(Value)).HintText(FText::FromString(Hint)).IsPassword(bPassword).Font(Body);
    };
    return SNew(SBorder).BorderBackgroundColor(FLinearColor(0, 0, 0, 0.72f)).HAlign(HAlign_Center).VAlign(VAlign_Center)
    [
        SNew(SBox).WidthOverride(560)
        [
            SNew(SBorder).Padding(28).BorderBackgroundColor(FLinearColor(0.09f, 0.08f, 0.07f, 0.96f))
            [
                SNew(SVerticalBox)
                + SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 6)[SNew(STextBlock).Text(FText::FromString(TEXT("Torn Veil — Living Alpha"))).Font(Title).ColorAndOpacity(FLinearColor(0.93f, 0.86f, 0.66f))]
                + SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 16)[SNew(STextBlock).AutoWrapText(true).Font(Body).ColorAndOpacity(FLinearColor(0.7f, 0.7f, 0.7f))
                    .Text(FText::FromString(TEXT("Enter the server address and the account name and token your host gave you. You live as an ordinary person in a world that keeps going while you are away.")))]
                + SVerticalBox::Slot().AutoHeight()[Label(TEXT("Server (host:port)"))]
                + SVerticalBox::Slot().AutoHeight().Padding(0, 2, 0, 10)[Field(ServerBox, Config.Server, TEXT("e.g. 100.86.43.22:7400"), false)]
                + SVerticalBox::Slot().AutoHeight()[Label(TEXT("Account"))]
                + SVerticalBox::Slot().AutoHeight().Padding(0, 2, 0, 10)[Field(AccountBox, Config.Account, TEXT("account name"), false)]
                + SVerticalBox::Slot().AutoHeight()[Label(TEXT("Token"))]
                + SVerticalBox::Slot().AutoHeight().Padding(0, 2, 0, 16)[Field(TokenBox, Config.Token, TEXT("secret token"), true)]
                + SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 12)
                [
                    SNew(SButton).IsEnabled_Lambda([this] { return !bNewOnly; }).HAlign(HAlign_Center).ContentPadding(FMargin(10, 8))
                    .OnClicked_Lambda([this] { Submit(false); return FReply::Handled(); })
                    [SNew(STextBlock).Font(Body).Text(FText::FromString(TEXT("Continue my character")))]
                ]
                + SVerticalBox::Slot().AutoHeight()[Label(TEXT("…or begin a new character"))]
                + SVerticalBox::Slot().AutoHeight().Padding(0, 2, 0, 6)[Field(NameBox, Config.NewName, TEXT("Given and family name"), false)]
                + SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 6)
                [
                    SNew(SHorizontalBox)
                    + SHorizontalBox::Slot().AutoWidth().Padding(0, 0, 16, 0)[SNew(SCheckBox).Style(FCoreStyle::Get(), "RadioButton").IsChecked_Lambda([this] { return bMale ? ECheckBoxState::Unchecked : ECheckBoxState::Checked; }).OnCheckStateChanged_Lambda([this](ECheckBoxState) { bMale = false; })[Label(TEXT("Woman"))]]
                    + SHorizontalBox::Slot().AutoWidth()[SNew(SCheckBox).Style(FCoreStyle::Get(), "RadioButton").IsChecked_Lambda([this] { return bMale ? ECheckBoxState::Checked : ECheckBoxState::Unchecked; }).OnCheckStateChanged_Lambda([this](ECheckBoxState) { bMale = true; })[Label(TEXT("Man"))]]
                ]
                + SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 14)
                [
                    SNew(SButton).HAlign(HAlign_Center).ContentPadding(FMargin(10, 8)).OnClicked_Lambda([this] { Submit(true); return FReply::Handled(); })
                    [SNew(STextBlock).Font(Body).Text(FText::FromString(TEXT("Begin new character")))]
                ]
                + SVerticalBox::Slot().AutoHeight().Padding(0, 0, 0, 12)[SNew(STextBlock).AutoWrapText(true).Font(Body).ColorAndOpacity(FLinearColor(1.f, 0.7f, 0.45f)).Text_Lambda([this] { return FText::FromString(Message_); })]
                + SVerticalBox::Slot().AutoHeight()
                [
                    SNew(SButton).HAlign(HAlign_Center).OnClicked_Lambda([this] { UKismetSystemLibrary::QuitGame(this, nullptr, EQuitPreference::Quit, false); return FReply::Handled(); })
                    [SNew(STextBlock).Font(Body).Text(FText::FromString(TEXT("Quit")))]
                ]
            ]
        ]
    ];
}
