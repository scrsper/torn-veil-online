#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "PCGSettings.h"
#include "PCGElement.h"
#include "TVWorldProjection.generated.h"

class UHierarchicalInstancedStaticMeshComponent;
class UProceduralMeshComponent;
class UPCGComponent;

/** PCG receives already-filtered substrate points. It never creates gameplay entities. */
UCLASS()
class TORNVEILONLINE_API UTVPCGSubstrateSettings : public UPCGSettings {
    GENERATED_BODY()
public:
    UPROPERTY() TArray<FTransform> Points;
protected:
    virtual TArray<FPCGPinProperties> InputPinProperties() const override { return {}; }
    virtual TArray<FPCGPinProperties> OutputPinProperties() const override;
    virtual FPCGElementPtr CreateElement() const override;
};

/** One region's presentation. Canonical identities map to component/instance references;
 * PCG instances carry a separate decorative tag and never collide or send actions. */
UCLASS()
class TORNVEILONLINE_API ATVRegionProjection : public AActor {
    GENERATED_BODY()
public:
    ATVRegionProjection();
    void Build(const TSharedPtr<FJsonObject>& Region);
    void UpdateDynamic(const TSharedPtr<FJsonObject>& Data);
    FString RegionId;
    FVector CanonicalBase;
    int32 InstanceCount() const;
    int32 DecorativeCount = 0;
    double BuildMilliseconds = 0;
    UPROPERTY(BlueprintReadOnly) double PCGMilliseconds = 0;
    TMap<FString, TArray<FString>> CanonicalVisuals;
private:
    UPROPERTY() TMap<FString, TObjectPtr<UHierarchicalInstancedStaticMeshComponent>> Batches;
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> Terrain;
    UPROPERTY() TObjectPtr<UPCGComponent> Dressing;
    FString DynamicSignature;
    double PCGStarted = 0;
    UFUNCTION() void PCGFinished(UPCGComponent* Component);
    void Piece(const FString& Id, const FString& Mesh, const FVector& Center, const FVector& Size, float Yaw = 0, const FString& Material = TEXT(""), bool bDynamic = false);
    void Structure(const TSharedPtr<FJsonObject>& Place);
    void Dress(const TSharedPtr<FJsonObject>& Region);
};

UCLASS()
class TORNVEILONLINE_API ATVWorldProjection : public AActor {
    GENERATED_BODY()
public:
    ATVWorldProjection();
    void Apply(const TSharedPtr<FJsonObject>& Frame, const FVector& Origin);
    FString Metrics() const;
private:
    UPROPERTY() TMap<FString, TObjectPtr<ATVRegionProjection>> Regions;
    double LastFrameMilliseconds = 0;
};
