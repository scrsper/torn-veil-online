#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TVProjectionInstances.generated.h"

class UHierarchicalInstancedStaticMeshComponent;
class UMaterialInterface;
class UStaticMesh;

/** Renderer-owned batch for deterministic settlement projection pieces. */
UCLASS()
class TORNVEILONLINE_API ATVProjectionInstances : public AActor
{
    GENERATED_BODY()

public:
    ATVProjectionInstances();

    UFUNCTION(BlueprintCallable, Category="Torn Veil|Projection")
    void Configure(UStaticMesh* Mesh, UMaterialInterface* Material, bool bCameraBlock);

    UFUNCTION(BlueprintCallable, Category="Torn Veil|Projection")
    void AddVisual(FVector Location, FRotator Rotation, FVector Scale);

    UFUNCTION(BlueprintCallable, Category="Torn Veil|Projection")
    void FinalizeVisuals();

private:
    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UHierarchicalInstancedStaticMeshComponent> Instances;
};
