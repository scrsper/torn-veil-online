#pragma once
#include "CoreMinimal.h"

/**
 * Where and as whom this client connects. Living Alpha protocol constants mirror
 * src/server/protocol.ts; a mismatch is refused by the server with an explicit reason.
 *
 * Sources, highest priority first:
 *   1. command line: -TVServer=host:port -TVAccount=id -TVToken=secret -TVCharacter=auto|new|p_N
 *                    -TVName="Given Family" -TVSex=f|m
 *   2. %LOCALAPPDATA%/TornVeil/Client/<profile>.json (profile via -TVProfile=, default "default"),
 *      written by the sign-in screen
 *   3. neither: the legacy local developer bridge (ws://127.0.0.1:$TORN_VEIL_PORT or 8787), no account
 */
struct TORNVEILONLINE_API FTVClientConfig
{
    static constexpr int32 AlphaProtocol = 1;
    FString Server;      // host:port
    FString Account;
    FString Token;
    FString Character = TEXT("auto");
    FString NewName;
    FString NewSex = TEXT("f");

    bool IsAlpha() const { return !Account.IsEmpty(); }
    bool IsComplete() const { return !Server.IsEmpty() && !Account.IsEmpty() && !Token.IsEmpty(); }
    FString Url() const;
    TMap<FString, FString> Headers() const;
    static FString FilePath();
    static FTVClientConfig Load();
    bool Save() const;
};
