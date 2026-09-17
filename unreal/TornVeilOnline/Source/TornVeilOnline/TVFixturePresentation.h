#pragma once

#include "CoreMinimal.h"
#include "TVFixturePresentation.generated.h"

/** One renderer-neutral piece of a fixture occupying a canonical one metre cell. */
USTRUCT(BlueprintType)
struct TORNVEILONLINE_API FTVFixturePiece
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadOnly)
    FString MeshRole;

    UPROPERTY(EditAnywhere, BlueprintReadOnly)
    FString MaterialRole;

    /** Used only when the environment palette has no mesh for MeshRole. */
    UPROPERTY(EditAnywhere, BlueprintReadOnly)
    FString FallbackMesh;

    /** Centred on the canonical cell centre; X/Y are horizontal cm and Z is above support plane. */
    UPROPERTY(EditAnywhere, BlueprintReadOnly)
    FVector CenterOffsetCm = FVector::ZeroVector;

    /** Presentation bounds in cm. Each horizontal dimension fits the one-cell footprint. */
    UPROPERTY(EditAnywhere, BlueprintReadOnly)
    FVector SizeCm = FVector::ZeroVector;

    UPROPERTY(EditAnywhere, BlueprintReadOnly)
    float Yaw = 0.f;
};

/** Small semantic recipes for projecting canonical furnishing cells into authored assets. */
class TORNVEILONLINE_API FTVFixturePresentation
{
public:
    /** Returns an empty array for an unsupported role. This function has no world or asset side effects. */
    static TArray<FTVFixturePiece> Describe(const FString& Role);
};
