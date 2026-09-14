#include "TVItemPresentationCatalog.h"

FTVItemPresentationDescriptor FTVItemPresentationCatalog::Describe(const FString& Type) {
    FTVItemPresentationDescriptor D;
    if(Type==TEXT("bread")||Type==TEXT("cheese")||Type==TEXT("meat")||Type==TEXT("pie")||Type==TEXT("stew")){D.MeshPath=TEXT("/Engine/BasicShapes/Sphere");D.Size=FVector(25,18,10);D.HeightOffset=5;D.bFallback=false;}
    else if(Type==TEXT("lantern")||Type==TEXT("ale")){D.MeshPath=TEXT("/Engine/BasicShapes/Cylinder");D.Size=FVector(15,15,28);D.HeightOffset=14;D.bFallback=false;}
    else if(Type==TEXT("sword")||Type==TEXT("dagger")||Type==TEXT("axe")||Type==TEXT("hammer")||Type==TEXT("pickaxe")||Type==TEXT("saw")||Type==TEXT("stoneaxe")){D.MeshPath=TEXT("/Engine/BasicShapes/Cube");D.Size=FVector(55,7,7);D.HeightOffset=6;D.Yaw=24;D.bFallback=false;}
    else if(Type==TEXT("book")){D.Size=FVector(24,18,7);D.HeightOffset=4;D.bFallback=false;}
    else if(Type==TEXT("log")||Type==TEXT("stick")){D.MeshPath=TEXT("/Engine/BasicShapes/Cylinder");D.Size=FVector(12,12,Type==TEXT("log")?65:35);D.HeightOffset=8;D.Yaw=90;D.bFallback=false;}
    else if(Type==TEXT("stone")){D.MeshPath=TEXT("/Engine/BasicShapes/Sphere");D.Size=FVector(22,18,14);D.HeightOffset=7;D.bFallback=false;}
    return D;
}
