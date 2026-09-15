#pragma once
#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "TVDirectionalBlendSpace.generated.h"
/** Standard engine BlendSpace with a reproducible editor-authoring seam. No movement code. */
UCLASS()
class TORNVEILONLINE_API UTVLocomotionAuthoring : public UBlueprintFunctionLibrary {
    GENERATED_BODY()
public:
    UFUNCTION(BlueprintCallable,Category="Torn Veil|Authoring") static bool ConfigureSamples(class UBlendSpace* Blend,const TArray<class UAnimSequence*>& Clips,const TArray<FVector>& Positions,const TArray<float>& Rates);
};
