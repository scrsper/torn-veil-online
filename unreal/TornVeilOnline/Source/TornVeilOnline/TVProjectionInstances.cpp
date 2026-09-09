#include "TVProjectionInstances.h"

#include "Components/HierarchicalInstancedStaticMeshComponent.h"

ATVProjectionInstances::ATVProjectionInstances()
{
    Instances = CreateDefaultSubobject<UHierarchicalInstancedStaticMeshComponent>(TEXT("Instances"));
    SetRootComponent(Instances);
    Instances->SetMobility(EComponentMobility::Static);
    Instances->SetCollisionResponseToAllChannels(ECR_Ignore);
    Instances->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Instances->bCastDynamicShadow = true;
}

void ATVProjectionInstances::Configure(UStaticMesh* Mesh, UMaterialInterface* Material, bool bCameraBlock)
{
    Instances->SetStaticMesh(Mesh);
    Instances->SetMaterial(0, Material);
    Instances->SetCollisionEnabled(bCameraBlock ? ECollisionEnabled::QueryOnly : ECollisionEnabled::NoCollision);
    Instances->SetCollisionResponseToAllChannels(ECR_Ignore);
    if (bCameraBlock)
    {
        Instances->SetCollisionResponseToChannel(ECC_Camera, ECR_Block);
    }
}

void ATVProjectionInstances::AddVisual(FVector Location, FRotator Rotation, FVector Scale)
{
    Instances->AddInstance(FTransform(Rotation, Location, Scale), true);
}

void ATVProjectionInstances::FinalizeVisuals()
{
    Instances->BuildTreeIfOutdated(false, true);
    Instances->MarkRenderStateDirty();
}
