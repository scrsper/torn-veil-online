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
    bool FindVisualBounds(const FString& CanonicalId, FBox& OutBounds) const;
    UPROPERTY(BlueprintReadOnly) FString RegionId;
    UPROPERTY(BlueprintReadOnly) FVector CanonicalBase;
    int32 InstanceCount() const;
    int32 DecorativeCount = 0;
    double BuildMilliseconds = 0;
    UPROPERTY(BlueprintReadOnly) double PCGMilliseconds = 0;
    TMap<FString, TArray<FString>> CanonicalVisuals;
private:
    friend class FTVRegionalCameraCollisionTest;
    friend class FTVRegionalDressingClearanceTest;
    /** Presentation query only: never participates in canonical movement or navigation. */
    void CameraBlock(const FVector& Center, const FVector& Size, float Yaw = 0, float Roll = 0);
    UPROPERTY() TArray<TObjectPtr<class UBoxComponent>> CameraBlocks;
    UPROPERTY() TMap<FString, TObjectPtr<UHierarchicalInstancedStaticMeshComponent>> Batches;
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> Terrain;
    UPROPERTY() TObjectPtr<UPCGComponent> Dressing;
    FString DynamicSignature;
    double PCGStarted = 0;
    UFUNCTION() void PCGFinished(UPCGComponent* Component);
    void Piece(const FString& Id, const FString& Mesh, const FVector& Center, const FVector& Size, float Yaw = 0, const FString& Material = TEXT(""), bool bDynamic = false);
    void Structure(const TSharedPtr<FJsonObject>& Place);
    void Dress(const TSharedPtr<FJsonObject>& Region);
    /** Decorative, non-colliding instance placed by the mesh pivot; never a canonical visual. */
    void Decor(const FString& MeshPath, const FTransform& Local, float CullEnd = 0, bool bShadow = true, const FString& Material = TEXT(""));
    void Woodland(const TSharedPtr<FJsonObject>& Region);
    /** Functional exterior dressing derived from canonical place type, footprint, door and paths. */
    void DressPlaces(const TSharedPtr<FJsonObject>& Region);
    /** Uniformly scaled, ground-seated decorative prop at canonical centimetres. */
    void Prop(const TCHAR* Role, const TCHAR* Fallback, const FVector& CanonicalCm, float Yaw, float Height, float CullEnd = 0);
    void Lamp(const FVector& CanonicalCm, float Candela, float Radius, const FLinearColor& Color = FLinearColor(1., .72, .45));
    UPROPERTY() TArray<TObjectPtr<class UPointLightComponent>> Lamps;
};

/** Far horizon only: coarse canonical landform and forest density beyond the streamed regions.
 * Rebuilt when the resident centre changes. No collision, identities or gameplay facts. */
UCLASS()
class TORNVEILONLINE_API ATVVistaProjection : public AActor {
    GENERATED_BODY()
public:
    ATVVistaProjection();
    void Build(const TSharedPtr<FJsonObject>& Vista);
    FVector CanonicalBase;
    FString Center;
    int32 TreeCount = 0;
    double BuildMilliseconds = 0;
private:
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> Ground;
    UPROPERTY() TMap<FString, TObjectPtr<UHierarchicalInstancedStaticMeshComponent>> Trees;
};

UCLASS()
class TORNVEILONLINE_API ATVWorldProjection : public AActor {
    GENERATED_BODY()
public:
    ATVWorldProjection();
    void Apply(const TSharedPtr<FJsonObject>& Frame, const FVector& Origin);
    FString Metrics() const;
    void ResetRegions();
    int32 RegionCount() const { return Regions.Num(); }
    /** Returns only the measured instances mapped to one canonical id; never a whole HISM batch. */
    bool FindVisualBounds(const FString& CanonicalId, FBox& OutBounds) const;
private:
    UPROPERTY() TMap<FString, TObjectPtr<ATVRegionProjection>> Regions;
    UPROPERTY() TObjectPtr<ATVVistaProjection> Vista;
    double LastFrameMilliseconds = 0;
};
