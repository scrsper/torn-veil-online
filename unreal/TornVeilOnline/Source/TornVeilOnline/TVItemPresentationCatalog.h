#pragma once
#include "CoreMinimal.h"

/** Central, replaceable mapping from canonical descriptors to presentation assets. The paths
 * are renderer data only and deliberately never cross back into TypeScript. */
struct FTVItemPresentationDescriptor {
    FString MeshPath=TEXT("/Engine/BasicShapes/Cube");
    FVector Size=FVector(24,18,12);
    float HeightOffset=6;
    float Yaw=0;
    bool bFallback=true;
};

class FTVItemPresentationCatalog {
public:
    static FTVItemPresentationDescriptor Describe(const FString& CanonicalType);
};
