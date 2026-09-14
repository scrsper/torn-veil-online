#include "TVWildlifePresentation.h"
#include "Components/SceneComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "UObject/ConstructorHelpers.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"

ATVWildlifePresentation::ATVWildlifePresentation() {
    PrimaryActorTick.bCanEverTick=true;
    VisualRoot=CreateDefaultSubobject<USceneComponent>(TEXT("WildlifeVisualRoot"));SetRootComponent(VisualRoot);
    Torso=CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Torso"));Torso->SetupAttachment(VisualRoot);
    Neck=CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Neck"));Neck->SetupAttachment(VisualRoot);
    Head=CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Head"));Head->SetupAttachment(VisualRoot);
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Sphere(TEXT("/Engine/BasicShapes/Sphere"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cylinder(TEXT("/Engine/BasicShapes/Cylinder"));
    if(Sphere.Succeeded()){Torso->SetStaticMesh(Sphere.Object);Head->SetStaticMesh(Sphere.Object);}
    if(Cylinder.Succeeded())Neck->SetStaticMesh(Cylinder.Object);
    Torso->SetRelativeLocation(FVector(0,0,72));Torso->SetRelativeScale3D(FVector(.82,.30,.38));
    Neck->SetRelativeLocation(FVector(32,0,103));Neck->SetRelativeRotation(FRotator(0,-25,0));Neck->SetRelativeScale3D(FVector(.14,.14,.44));
    Head->SetRelativeLocation(FVector(58,0,128));Head->SetRelativeScale3D(FVector(.30,.20,.19));
    for(int32 Index=0;Index<4;Index++){
        auto* Leg=CreateDefaultSubobject<UStaticMeshComponent>(*FString::Printf(TEXT("Leg%d"),Index));Leg->SetupAttachment(VisualRoot);
        if(Cylinder.Succeeded())Leg->SetStaticMesh(Cylinder.Object);
        const float X=Index<2?27.f:-27.f,Y=Index%2?18.f:-18.f;Leg->SetRelativeLocation(FVector(X,Y,34));Leg->SetRelativeScale3D(FVector(.065,.065,.40));Legs.Add(Leg);
    }
    TArray<UStaticMeshComponent*> Parts={Torso,Neck,Head};for(const TObjectPtr<UStaticMeshComponent>& Leg:Legs)Parts.Add(Leg.Get());
    for(auto* Part:Parts){Part->SetCollisionEnabled(ECollisionEnabled::NoCollision);Part->SetGenerateOverlapEvents(false);Part->ComponentTags.Add(TEXT("TV.Presentation.WildlifeProxy"));}
}

FVector ATVWildlifePresentation::ProjectedPosition(const TSharedPtr<FJsonObject>& P,const FVector& Origin,float Units) const {
    return FVector((P->GetNumberField(TEXT("x"))-Origin.X)*Units,(P->GetNumberField(TEXT("z"))-Origin.Z)*Units,(P->GetNumberField(TEXT("y"))-Origin.Y)*Units+45);
}

bool ATVWildlifePresentation::Project(const TSharedPtr<FJsonObject>& D,const FVector& Origin,float Units,bool bFirst) {
    if(!D||!D->TryGetStringField(TEXT("bodyId"),BodyId)||!D->TryGetStringField(TEXT("creatureId"),CreatureId)
        ||!D->TryGetStringField(TEXT("speciesId"),SpeciesId)||!D->TryGetStringField(TEXT("activity"),Activity))return false;
    const TSharedPtr<FJsonObject>* P=nullptr;const TSharedPtr<FJsonObject>* V=nullptr;
    if(!D->TryGetObjectField(TEXT("pos"),P)||!D->TryGetObjectField(TEXT("vel"),V))return false;
    PreviousPosition=bFirst?ProjectedPosition(*P,Origin,Units):GetActorLocation();TargetPosition=ProjectedPosition(*P,Origin,Units);
    CanonicalVelocity=FVector((*V)->GetNumberField(TEXT("x")),(*V)->GetNumberField(TEXT("z")),(*V)->GetNumberField(TEXT("y")))*Units;
    double Yaw=0;D->TryGetNumberField(TEXT("yaw"),Yaw);TargetYaw=FMath::RadiansToDegrees(FMath::Atan2(-FMath::Cos(Yaw),-FMath::Sin(Yaw)));
    double Scale=1;D->TryGetNumberField(TEXT("scale"),Scale);VisualScale=FMath::Clamp(static_cast<float>(Scale),.25f,2.f);
    double Health=1;D->TryGetNumberField(TEXT("condition"),Health);Condition=FMath::Clamp(static_cast<float>(Health),0.f,1.f);
    D->TryGetBoolField(TEXT("dead"),bDead);D->TryGetStringField(TEXT("regionId"),RegionId);
    SnapshotAge=0;if(bFirst){SetActorLocation(TargetPosition);SetActorRotation(FRotator(0,TargetYaw,0));}
    SetActorScale3D(FVector(VisualScale));return true;
}

void ATVWildlifePresentation::Tick(float Dt) {
    const double TickStarted=FPlatformTime::Seconds();
    Super::Tick(Dt);SnapshotAge+=Dt;VisualAge+=Dt;
    const FVector Error=TargetPosition-GetActorLocation();
    if(Error.Size()>500)SetActorLocation(TargetPosition);else SetActorLocation(FMath::Lerp(PreviousPosition,TargetPosition,FMath::Clamp(SnapshotAge/.10f,0.f,1.f)));
    SetActorRotation(FMath::RInterpTo(GetActorRotation(),FRotator(0,TargetYaw,0),Dt,bDead?4.f:10.f));
    const bool bFlee=Activity==TEXT("flee"),bMoving=bFlee||Activity==TEXT("walk");
    const float Pace=bFlee?12.f:6.f,Swing=bMoving?FMath::Sin(VisualAge*Pace)*22.f:0.f;
    for(int32 Index=0;Index<Legs.Num();Index++)Legs[Index]->SetRelativeRotation(FRotator((Index%2?1.f:-1.f)*Swing,0,0));
    float TorsoZ=72,HeadZ=128,HeadPitch=0,TorsoPitch=bFlee?-8.f:0.f;
    if(Activity==TEXT("forage")||Activity==TEXT("eat")){HeadZ=82+FMath::Sin(VisualAge*2)*3;HeadPitch=38;}
    else if(Activity==TEXT("drink")){HeadZ=66;HeadPitch=52;}
    else if(Activity==TEXT("rest")){TorsoZ=61;HeadZ=104;}
    else if(Activity==TEXT("sleep")){TorsoZ=35;HeadZ=48;}
    if(bDead){TorsoZ=30;HeadZ=28;TorsoPitch=0;VisualRoot->SetRelativeRotation(FRotator(0,0,72));}
    else VisualRoot->SetRelativeRotation(FRotator::ZeroRotator);
    Torso->SetRelativeLocation(FVector(0,0,TorsoZ));Torso->SetRelativeRotation(FRotator(TorsoPitch,0,0));
    Head->SetRelativeLocation(FVector(58,0,HeadZ));Head->SetRelativeRotation(FRotator(HeadPitch,0,0));
    const double TickMs=(FPlatformTime::Seconds()-TickStarted)*1000.;TickTotalMs+=TickMs;TickMaxMs=FMath::Max(TickMaxMs,TickMs);TickSamples++;
}

void ATVWildlifePresentation::RebasePresentation(const FVector& Delta){PreviousPosition+=Delta;TargetPosition+=Delta;SetActorLocation(GetActorLocation()+Delta);}

FString ATVWildlifePresentation::PresentationDiagnostics() const {
    auto J=MakeShared<FJsonObject>();J->SetStringField(TEXT("bodyId"),BodyId);J->SetStringField(TEXT("creatureId"),CreatureId);
    J->SetStringField(TEXT("speciesId"),SpeciesId);J->SetStringField(TEXT("activity"),Activity);J->SetBoolField(TEXT("dead"),bDead);
    J->SetNumberField(TEXT("condition"),Condition);J->SetNumberField(TEXT("speedCmPerSecond"),CanonicalVelocity.Size2D());
    J->SetNumberField(TEXT("tickSamples"),TickSamples);J->SetNumberField(TEXT("tickMeanMs"),TickSamples?TickTotalMs/TickSamples:0);J->SetNumberField(TEXT("tickMaxMs"),TickMaxMs);
    J->SetBoolField(TEXT("canonicalAuthority"),false);J->SetStringField(TEXT("asset"),TEXT("Engine basic-shape temporary proxy"));
    FString Out;FJsonSerializer::Serialize(J,TJsonWriterFactory<>::Create(&Out));return Out;
}
