#include "TVClientConfig.h"
#include "Dom/JsonObject.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "HAL/PlatformMisc.h"
#include "HAL/PlatformProcess.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

/** Per-user, per-profile: %LOCALAPPDATA%/TornVeil/Client/<profile>.json. -TVProfile=<name> selects
 * another profile, so two local players (or two accounts) never share credentials. */
FString FTVClientConfig::FilePath()
{
    FString Profile = TEXT("default");
    FParse::Value(FCommandLine::Get(), TEXT("TVProfile="), Profile);
    Profile = FPaths::MakeValidFileName(Profile);
    return FPaths::Combine(FPlatformProcess::UserSettingsDir(), TEXT("TornVeil"), TEXT("Client"), Profile + TEXT(".json"));
}

FString FTVClientConfig::Url() const
{
    if (!Server.IsEmpty()) return FString::Printf(TEXT("ws://%s"), *Server);
    const FString Port = FPlatformMisc::GetEnvironmentVariable(TEXT("TORN_VEIL_PORT"));
    return FString::Printf(TEXT("ws://127.0.0.1:%s"), Port.IsNumeric() ? *Port : TEXT("8787"));
}

TMap<FString, FString> FTVClientConfig::Headers() const
{
    TMap<FString, FString> H = {
        { TEXT("X-Torn-Veil-Client"), TEXT("unreal") },
        { TEXT("X-Torn-Veil-Region-Protocol"), TEXT("2") },
        { TEXT("X-Torn-Veil-Interaction-Protocol"), TEXT("2") },
        { TEXT("X-Torn-Veil-Alpha-Protocol"), FString::FromInt(AlphaProtocol) },
    };
    if (IsAlpha())
    {
        H.Add(TEXT("X-Torn-Veil-Account"), Account);
        H.Add(TEXT("X-Torn-Veil-Token"), Token);
        H.Add(TEXT("X-Torn-Veil-Character"), Character.IsEmpty() ? TEXT("auto") : Character);
        if (Character == TEXT("new"))
        {
            H.Add(TEXT("X-Torn-Veil-Character-Name"), NewName);
            H.Add(TEXT("X-Torn-Veil-Character-Sex"), NewSex == TEXT("m") ? TEXT("m") : TEXT("f"));
        }
    }
    return H;
}

FTVClientConfig FTVClientConfig::Load()
{
    FTVClientConfig C;
    FString Raw;
    if (FFileHelper::LoadFileToString(Raw, *FilePath()))
    {
        TSharedPtr<FJsonObject> J;
        if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Raw), J) && J.IsValid())
        {
            J->TryGetStringField(TEXT("server"), C.Server);
            J->TryGetStringField(TEXT("account"), C.Account);
            J->TryGetStringField(TEXT("token"), C.Token);
            J->TryGetStringField(TEXT("character"), C.Character);
            J->TryGetStringField(TEXT("name"), C.NewName);
            J->TryGetStringField(TEXT("sex"), C.NewSex);
        }
    }
    const TCHAR* Cmd = FCommandLine::Get();
    FString V;
    if (FParse::Value(Cmd, TEXT("TVServer="), V)) C.Server = V;
    if (FParse::Value(Cmd, TEXT("TVAccount="), V)) C.Account = V;
    if (FParse::Value(Cmd, TEXT("TVToken="), V)) C.Token = V;
    if (FParse::Value(Cmd, TEXT("TVCharacter="), V)) C.Character = V;
    if (FParse::Value(Cmd, TEXT("TVName="), V)) C.NewName = V;
    if (FParse::Value(Cmd, TEXT("TVSex="), V)) C.NewSex = V;
    if (C.Character.IsEmpty()) C.Character = TEXT("auto");
    return C;
}

bool FTVClientConfig::Save() const
{
    TSharedRef<FJsonObject> J = MakeShared<FJsonObject>();
    J->SetStringField(TEXT("server"), Server);
    J->SetStringField(TEXT("account"), Account);
    J->SetStringField(TEXT("token"), Token);
    // A character, once created, is continued: never save "new" (it would create another).
    J->SetStringField(TEXT("character"), Character == TEXT("new") ? TEXT("auto") : Character);
    J->SetStringField(TEXT("name"), NewName);
    J->SetStringField(TEXT("sex"), NewSex);
    FString Out;
    FJsonSerializer::Serialize(J, TJsonWriterFactory<>::Create(&Out));
    return FFileHelper::SaveStringToFile(Out, *FilePath());
}
