#pragma once
#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/HUD.h"
#include "TVGameMode.generated.h"
UCLASS()
class TORNVEILONLINE_API ATVHUD : public AHUD {
    GENERATED_BODY()
public: virtual void DrawHUD() override;
};
UCLASS()
class TORNVEILONLINE_API ATVGameMode : public AGameModeBase {
    GENERATED_BODY()
public: ATVGameMode();
};
