#pragma once
#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "TVPlayableLighting.generated.h"

/** Neutral v0.1 daylight, not a second simulation clock or weather authority. */
UCLASS()
class TORNVEILONLINE_API UTVPlayableLighting : public UBlueprintFunctionLibrary {
    GENERATED_BODY()
public:
    /** Shared by map setup and ordinary PIE/game startup. Idempotent; refuses duplicates. */
    UFUNCTION(BlueprintCallable, Category="Torn Veil|Presentation")
    static FString EnsureDaylight(UWorld* World);
    /** Empty means valid. Does not repair the world or change the viewport mode. */
    UFUNCTION(BlueprintCallable, Category="Torn Veil|Presentation")
    static FString ValidateDaylight(UWorld* World, bool RequireLitViewport = false);
    /** Loads the actual completed PNG through Unreal; no Python imaging dependencies. */
    UFUNCTION(BlueprintCallable, Category="Torn Veil|Presentation")
    static FString RenderedFrameDiagnostics(const FString& Path);
};
