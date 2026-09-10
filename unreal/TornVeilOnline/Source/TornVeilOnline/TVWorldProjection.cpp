#include "TVWorldProjection.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "ProceduralMeshComponent.h"
#include "PCGComponent.h"
#include "PCGContext.h"
#include "PCGGraph.h"
#include "Data/PCGPointData.h"
#include "Elements/PCGStaticMeshSpawner.h"
#include "MeshSelectors/PCGMeshSelectorWeighted.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInterface.h"
#include "EngineUtils.h"
#include "Engine/DirectionalLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"

static const FString Kit = TEXT("/Game/ThirdParty/Quaternius/Meshes/");
static const FString Mat = TEXT("/Game/TornVeil/Materials/");
static FVector Position(const TSharedPtr<FJsonObject>& P) { return FVector(P->GetNumberField(TEXT("x")), P->GetNumberField(TEXT("z")), P->GetNumberField(TEXT("y"))); }
static double N(const TSharedPtr<FJsonObject>& P, const TCHAR* Key, double Default = 0) { double V; return P->TryGetNumberField(Key,V) ? V : Default; }
static FString S(const TSharedPtr<FJsonObject>& P, const TCHAR* Key) { FString V; P->TryGetStringField(Key,V); return V; }
static const TArray<TSharedPtr<FJsonValue>>& Rows(const TSharedPtr<FJsonObject>& P, const TCHAR* Key) { static TArray<TSharedPtr<FJsonValue>> Empty; const TArray<TSharedPtr<FJsonValue>>* A; return P->TryGetArrayField(Key,A) ? *A : Empty; }

class FTVSubstrateElement : public IPCGElement {
protected:
    virtual bool ExecuteInternal(FPCGContext* Context) const override {
        const auto* Settings = Context->GetInputSettings<UTVPCGSubstrateSettings>();
        auto* Data = NewObject<UPCGPointData>();
        auto& Points = Data->GetMutablePoints();
        for (int32 I=0; I<Settings->Points.Num(); ++I) { FPCGPoint P; P.Transform=Settings->Points[I]; P.Density=1; P.Seed=I; Points.Add(P); }
        auto& Out=Context->OutputData.TaggedData.Emplace_GetRef(); Out.Data=Data; Out.Pin=PCGPinConstants::DefaultOutputLabel; Out.Tags.Add(TEXT("TV.Decorative.NoGameplay"));
        return true;
    }
};
TArray<FPCGPinProperties> UTVPCGSubstrateSettings::OutputPinProperties() const { return { FPCGPinProperties(PCGPinConstants::DefaultOutputLabel,EPCGDataType::Point) }; }
FPCGElementPtr UTVPCGSubstrateSettings::CreateElement() const { return MakeShared<FTVSubstrateElement>(); }

ATVRegionProjection::ATVRegionProjection() {
    PrimaryActorTick.bCanEverTick=false;
    SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("RegionOrigin")));
    Terrain=CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("CanonicalTerrain")); Terrain->SetupAttachment(RootComponent); Terrain->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Dressing=CreateDefaultSubobject<UPCGComponent>(TEXT("DecorativePCG")); Dressing->GenerationTrigger=EPCGComponentGenerationTrigger::GenerateOnDemand; Dressing->OnPCGGraphGeneratedExternal.AddDynamic(this,&ATVRegionProjection::PCGFinished);
    Tags.Add(TEXT("TV.Canonical.Region"));
}
void ATVRegionProjection::Piece(const FString& Id, const FString& MeshPath, const FVector& Center, const FVector& Size, float Yaw, const FString& Material, bool bDynamic) {
    const FString Key=(bDynamic?TEXT("dynamic:"):TEXT("static:"))+MeshPath+Material;
    auto* Mesh=LoadObject<UStaticMesh>(nullptr,*MeshPath); if(!Mesh) return;
    auto* Batch=Batches.FindRef(Key).Get();
    if(!Batch) { Batch=NewObject<UHierarchicalInstancedStaticMeshComponent>(this); Batch->SetupAttachment(RootComponent); Batch->SetStaticMesh(Mesh); Batch->SetCollisionEnabled(ECollisionEnabled::NoCollision); Batch->SetCanEverAffectNavigation(false); Batch->ComponentTags.Add(TEXT("TV.Canonical"));
        if(!Material.IsEmpty()) Batch->SetMaterial(0,LoadObject<UMaterialInterface>(nullptr,*Material));
        Batch->RegisterComponent(); Batches.Add(Key,Batch); }
    const FBox Box=Mesh->GetBoundingBox(); const FVector Ext=Box.GetSize();
    const FVector Scale(Size.X/FMath::Max(Ext.X,1.),Size.Y/FMath::Max(Ext.Y,1.),Size.Z/FMath::Max(Ext.Z,1.));
    const FQuat Rotation=FRotator(0,Yaw,0).Quaternion();
    const FVector Local=Center-CanonicalBase*100-Rotation.RotateVector(Box.GetCenter()*Scale);
    const int32 Index=Batch->AddInstance(FTransform(Rotation,Local,Scale));
    CanonicalVisuals.FindOrAdd(Id).Add(Key+TEXT("#")+FString::FromInt(Index));
}
void ATVRegionProjection::Structure(const TSharedPtr<FJsonObject>& P) {
    const FString Id=S(P,TEXT("id")), Family=S(P,TEXT("family")); const auto B=P->GetObjectField(TEXT("bounds"));
    const double X=N(B,TEXT("x0"))*100, Y=N(B,TEXT("z0"))*100, W=(N(B,TEXT("x1"))-N(B,TEXT("x0"))+1)*100, D=(N(B,TEXT("z1"))-N(B,TEXT("z0"))+1)*100, Z=N(B,TEXT("y0"))*100;
    bool Indoor=false; P->TryGetBoolField(TEXT("indoor"),Indoor);
    if (!Indoor && S(P,TEXT("type"))!=TEXT("stall") && S(P,TEXT("type"))!=TEXT("sawpit")) return;
    const float H=N(P,TEXT("wallHeight"),4)*100;
    Piece(Id,Kit+TEXT("Floor_WoodDark"),FVector(X+W/2,Y+D/2,Z-12),FVector(W,D,24));
    const TSharedPtr<FJsonObject>* Door; FVector DoorPos(-1e9); if(P->TryGetObjectField(TEXT("door"),Door)) DoorPos=Position(*Door)*100;
    FRandomStream Random(static_cast<int32>(N(P,TEXT("visualSeed"))));
    if(Indoor) for(int Side=0;Side<4;Side++) {
        const bool AlongX=Side<2; const double Length=AlongX?W:D, Fixed=Side==0?Y:Side==1?Y+D:Side==2?X:X+W;
        const bool DoorSide=AlongX?FMath::Abs(DoorPos.Y-Fixed)<160:FMath::Abs(DoorPos.X-Fixed)<160;
        const double DoorCenter=AlongX?DoorPos.X+50-X:DoorPos.Y+50-Y;
        // Segment around the canonical opening; never hide a reachable door inside a stock wall.
        TArray<TPair<double,double>> Spans;
        if(DoorSide && DoorCenter>0 && DoorCenter<Length) { Spans.Add({0,FMath::Max(0.,DoorCenter-65)}); Spans.Add({FMath::Min(Length,DoorCenter+65),Length});
            const FVector C=AlongX?FVector(X+DoorCenter,Fixed,Z+H-35):FVector(Fixed,Y+DoorCenter,Z+H-35);
            Piece(Id,Kit+TEXT("Roof_Support2"),C,FVector(130,24,70),AlongX?0:90); }
        else Spans.Add({0,Length});
        for(const auto Span:Spans) { const int Count=FMath::Max(1,FMath::CeilToInt((Span.Value-Span.Key)/300)); const double Segment=(Span.Value-Span.Key)/Count;
            for(int I=0;I<Count;I++) { const double Offset=Span.Key+(I+.5)*Segment; const FVector C=AlongX?FVector(X+Offset,Fixed,Z+H/2):FVector(Fixed,Y+Offset,Z+H/2);
                const FString Wall=Random.RandRange(0,3)==0?TEXT("Wall_Plaster_Window_Wide_Flat"):Family==TEXT("workshop")?TEXT("Wall_Plaster_WoodGrid"):TEXT("Wall_Plaster_Straight");
                Piece(Id,Kit+Wall,C,FVector(Segment,25,H),AlongX?0:90); }
        }
    }
    if(!Indoor) for(int Corner=0;Corner<4;Corner++) Piece(Id,Kit+TEXT("Roof_Support2"),FVector(X+(Corner%2?W:0),Y+(Corner<2?0:D),Z+H/2),FVector(25,25,H));
    // Repeated modular roof strips, fitted to the canonical footprint (never a premade house).
    const int Strips=FMath::Max(1,FMath::CeilToInt(D/200));
    for(int I=0;I<Strips;I++) Piece(Id,Kit+(Family==TEXT("agricultural")?TEXT("Roof_Wooden_2x1"):TEXT("Roof_Modular_RoundTiles")),FVector(X+W/2,Y+(I+.5)*D/Strips,Z+H+90),FVector(W+100,D/Strips+8,180));
    // Equipment comes from assemblies, never from a decorative building family.
}
void ATVRegionProjection::Build(const TSharedPtr<FJsonObject>& R) {
    const double Start=FPlatformTime::Seconds(); RegionId=S(R,TEXT("id")); const auto B=R->GetObjectField(TEXT("bounds")); CanonicalBase=FVector(N(B,TEXT("x0")),N(B,TEXT("z0")),0);
    TArray<FVector> Vertices,Normals; TArray<int32> Triangles; TArray<FVector2D> UV; TArray<FLinearColor> Colors; TArray<FProcMeshTangent> Tangents;
    const auto& Columns=Rows(R->GetObjectField(TEXT("terrain")),TEXT("columns")); const int Side=FMath::RoundToInt(FMath::Sqrt(static_cast<double>(Columns.Num())));
    for(const auto& V:Columns) { const auto& C=V->AsArray(); Vertices.Add(FVector(C[0]->AsNumber()-CanonicalBase.X,C[1]->AsNumber()-CanonicalBase.Y,C[2]->AsNumber())*100); Normals.Add(FVector::UpVector); UV.Add(FVector2D((C[0]->AsNumber()-CanonicalBase.X)/8,(C[1]->AsNumber()-CanonicalBase.Y)/8)); Colors.Add(FLinearColor::White); }
    for(int X=0;X<Side-1;X++) for(int Y=0;Y<Side-1;Y++) { int A=X*Side+Y, Next=A+Side; Triangles.Append({A,A+1,Next,A+1,Next+1,Next}); }
    Terrain->CreateMeshSection_LinearColor(0,Vertices,Triangles,Normals,UV,Colors,Tangents,false);
    Terrain->SetMaterial(0,LoadObject<UMaterialInterface>(nullptr,*(Mat+TEXT("M_TV_PH_Soil"))));
    for(const auto& P:Rows(R,TEXT("places"))) Structure(P->AsObject());
    for(const auto& Road:Rows(R,TEXT("roads"))) { const auto& Points=Rows(Road->AsObject(),TEXT("points")); for(int I=1;I<Points.Num();I++) { const FVector A=Position(Points[I-1]->AsObject())*100, Bp=Position(Points[I]->AsObject())*100, Delta=Bp-A; const FVector Mid=(A+Bp)/200; if(Mid.X<CanonicalBase.X||Mid.X>=CanonicalBase.X+256||Mid.Y<CanonicalBase.Y||Mid.Y>=CanonicalBase.Y+256) continue; Piece(S(Road->AsObject(),TEXT("id")),TEXT("/Engine/BasicShapes/Cube"),(A+Bp)/2+FVector(0,0,3),FVector(Delta.Size2D()+5,320,6),Delta.Rotation().Yaw,Mat+TEXT("M_TV_ValleyPath")); } }
    for(const auto& F:Rows(R,TEXT("fences"))) { const auto& C=F->AsArray(); Piece(TEXT("fence"),Kit+TEXT("Balcony_Simple_Straight"),FVector(C[0]->AsNumber()+.5,C[2]->AsNumber()+.5,C[1]->AsNumber()+.5)*100,FVector(100,18,100),C.Num()>3?C[3]->AsNumber():0); }
    for(const auto& Path:Rows(R,TEXT("paths"))) { const auto& C=Path->AsArray(); Piece(TEXT("path"),TEXT("/Engine/BasicShapes/Cube"),FVector(C[0]->AsNumber()+.5,C[2]->AsNumber()+.5,C[1]->AsNumber()-.5)*100,FVector(100,100,100),0,Mat+TEXT("M_TV_ValleyPath")); }
    for(const auto& V:Columns) { const auto& C=V->AsArray(); if(C[4]->AsNumber()>=0) Piece(TEXT("water"),TEXT("/Engine/BasicShapes/Cube"),FVector(C[0]->AsNumber(),C[1]->AsNumber(),C[4]->AsNumber())*100,FVector(N(R->GetObjectField(TEXT("terrain")),TEXT("stride"),8)*100,N(R->GetObjectField(TEXT("terrain")),TEXT("stride"),8)*100,5),0,Mat+TEXT("M_TV_RiverWater"));
    }
    Dress(R); BuildMilliseconds=(FPlatformTime::Seconds()-Start)*1000;
    UE_LOG(LogTemp,Display,TEXT("TV_REGION %s build_ms=%.2f instances=%d pcg_points=%d"),*RegionId,BuildMilliseconds,InstanceCount(),DecorativeCount);
}
void ATVRegionProjection::Dress(const TSharedPtr<FJsonObject>& R) {
    auto* Graph=NewObject<UPCGGraph>(this); UTVPCGSubstrateSettings* Source=nullptr; auto* SourceNode=Graph->AddNodeOfType(Source);
    FRandomStream Random(static_cast<int32>(N(R->GetObjectField(TEXT("decoration")),TEXT("seed"))));
    for(const auto& V:Rows(R->GetObjectField(TEXT("terrain")),TEXT("columns"))) { const auto& C=V->AsArray(); const double X=C[0]->AsNumber(), Y=C[1]->AsNumber();
        if(FMath::Fmod(X,8.)!=0 || FMath::Fmod(Y,8.)!=0 || C[4]->AsNumber()>=0 || C[3]->AsNumber()==26) continue;
        bool Occupied=false; for(const auto& P:Rows(R,TEXT("places"))) { const auto B=P->AsObject()->GetObjectField(TEXT("bounds")); if(X>=N(B,TEXT("x0"))-8 && X<=N(B,TEXT("x1"))+8 && Y>=N(B,TEXT("z0"))-8 && Y<=N(B,TEXT("z1"))+8) { Occupied=true; break; } }
        if(Occupied) continue;
        if(Random.FRand()>.35+C[5]->AsNumber()*.4) continue;
        const FVector Location=GetActorLocation()+FVector((X-CanonicalBase.X)*100,(Y-CanonicalBase.Y)*100,C[2]->AsNumber()*100+8);
        Source->Points.Add(FTransform(FRotator(0,Random.FRand()*360,0),Location,FVector(.5+Random.FRand()*.5)));
    }
    DecorativeCount=Source->Points.Num(); UPCGStaticMeshSpawnerSettings* Spawner=nullptr; auto* SpawnNode=Graph->AddNodeOfType(Spawner);
    Spawner->SetMeshSelectorType(UPCGMeshSelectorWeighted::StaticClass()); auto* Selector=Cast<UPCGMeshSelectorWeighted>(Spawner->MeshSelectorParameters);
    FPCGMeshSelectorWeightedEntry Entry; Entry.Descriptor.StaticMesh=TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(TEXT("/Game/ThirdParty/PolyHaven/Meshes/grass_medium_01_1k.grass_medium_01_1k"))); Entry.Descriptor.bUseDefaultCollision=false; Entry.Descriptor.BodyInstance.SetCollisionProfileName(TEXT("NoCollision")); Entry.Weight=8; Selector->MeshEntries.Add(Entry); FPCGMeshSelectorWeightedEntry Bush=Entry; Bush.Weight=2; Bush.Descriptor.StaticMesh=TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(TEXT("/Game/ThirdParty/Quaternius/Nature/Bush_1.Bush_1"))); Selector->MeshEntries.Add(Bush);
    Graph->AddEdge(SourceNode,PCGPinConstants::DefaultOutputLabel,SpawnNode,PCGPinConstants::DefaultInputLabel);
    Graph->AddEdge(SpawnNode,PCGPinConstants::DefaultOutputLabel,Graph->GetOutputNode(),PCGPinConstants::DefaultOutputLabel);
    Dressing->ComponentTags.Add(TEXT("TV.Decorative.NoGameplay")); Dressing->SetGraph(Graph); PCGStarted=FPlatformTime::Seconds(); Dressing->GenerateLocal(true);
}
void ATVRegionProjection::PCGFinished(UPCGComponent* Component) { PCGMilliseconds=(FPlatformTime::Seconds()-PCGStarted)*1000; UE_LOG(LogTemp,Display,TEXT("TV_PCG %s wall_ms=%.2f points=%d"),*RegionId,PCGMilliseconds,DecorativeCount); }
void ATVRegionProjection::UpdateDynamic(const TSharedPtr<FJsonObject>& Data) {
    const auto InRegion=[this](const FVector& P) { return P.X>=CanonicalBase.X && P.X<CanonicalBase.X+256 && P.Y>=CanonicalBase.Y && P.Y<CanonicalBase.Y+256; };
    auto Filtered=MakeShared<FJsonObject>();
    for(const auto Key:{TEXT("resources"),TEXT("items"),TEXT("crops"),TEXT("mechanisms"),TEXT("doors"),TEXT("fires"),TEXT("construction")}) { TArray<TSharedPtr<FJsonValue>> A; for(const auto& V:Rows(Data,Key)) if(InRegion(Position(V->AsObject()->GetObjectField(TEXT("pos"))))) A.Add(V); Filtered->SetArrayField(Key,A); }
    FString Signature; FJsonSerializer::Serialize(Filtered,TJsonWriterFactory<>::Create(&Signature)); if(Signature==DynamicSignature) return; DynamicSignature=Signature;
    for(auto& Pair:Batches) if(Pair.Key.StartsWith(TEXT("dynamic:"))) Pair.Value->ClearInstances();
    for(auto It=CanonicalVisuals.CreateIterator();It;++It) if(It.Value().Num() && It.Value()[0].StartsWith(TEXT("dynamic:"))) It.RemoveCurrent();
    for(const auto& V:Rows(Filtered,TEXT("resources"))) { const auto P=V->AsObject(); const FVector Pos=Position(P->GetObjectField(TEXT("pos")))*100; const FString Id=S(P,TEXT("id")); const bool Tree=S(P,TEXT("kind"))==TEXT("tree"), Available=S(P,TEXT("state"))==TEXT("available");
        if(Tree && Available) Piece(Id,TEXT("/Game/ThirdParty/Quaternius/Nature/CommonTree_1"),Pos+FVector(50,50,250),FVector(320,320,500),GetTypeHash(Id)%360,TEXT(""),true);
        else if(Tree) Piece(Id,Kit+TEXT("Roof_Support2"),Pos+FVector(50,50,20),FVector(65,65,40),0,TEXT(""),true);
        else if(Available) Piece(Id,TEXT("/Game/ThirdParty/Quaternius/Nature/Rock_1"),Pos+FVector(50,50,50),FVector(100,100,100),0,TEXT(""),true);
    }
    for(const auto& V:Rows(Filtered,TEXT("crops"))) { const auto P=V->AsObject(); const FString State=S(P,TEXT("state")); if(State==TEXT("fallow")) continue; const float H=State==TEXT("mature")?85:State==TEXT("harvested")?12:20+N(P,TEXT("growth"))*60;
        Piece(S(P,TEXT("id")),TEXT("/Engine/BasicShapes/Cone"),Position(P->GetObjectField(TEXT("pos")))*100+FVector(50,50,H/2),FVector(24,24,H),0,Mat+(State==TEXT("mature")?TEXT("M_TV_RipeCrop"):TEXT("M_TV_ValleyFoliage")),true); }
    for(const auto& V:Rows(Filtered,TEXT("items"))) { const auto P=V->AsObject(); Piece(S(P,TEXT("id")),Kit+TEXT("Floor_WoodDark"),Position(P->GetObjectField(TEXT("pos")))*100+FVector(0,0,12),FVector(30,25,24),0,TEXT(""),true); }
    for(const auto& V:Rows(Filtered,TEXT("mechanisms"))) { const auto P=V->AsObject(); const FVector Pos=Position(P->GetObjectField(TEXT("pos")))*100; for(int I=0;I<N(P,TEXT("parts"));I++) Piece(S(P,TEXT("id")),Kit+TEXT("Roof_Support2"),Pos+FVector(I*25,0,60),FVector(20,50,120),N(P,TEXT("condition"),1)<.5?20:FMath::Fmod(N(P,TEXT("operatedSeconds"))*90,360),TEXT(""),true); }
    for(const auto& V:Rows(Filtered,TEXT("construction"))) { const auto P=V->AsObject(); if(S(P,TEXT("state"))==TEXT("complete")) continue; const auto B=P->GetObjectField(TEXT("bounds")); const float H=50+200*N(P,TEXT("progress")); for(int I=0;I<4;I++) Piece(S(P,TEXT("id")),Kit+TEXT("Roof_Support2"),FVector(N(B,I%2?TEXT("x1"):TEXT("x0"))*100,N(B,I<2?TEXT("z0"):TEXT("z1"))*100,N(B,TEXT("y0"))*100+H/2),FVector(25,25,H),0,TEXT(""),true); }
    for(const auto& V:Rows(Filtered,TEXT("doors"))) { const auto P=V->AsObject(); bool Open=false; P->TryGetBoolField(TEXT("open"),Open); Piece(S(P,TEXT("id")),Kit+TEXT("Door_1_Flat"),Position(P->GetObjectField(TEXT("pos")))*100+FVector(50,50,100),FVector(100,12,200),N(P,TEXT("yaw"))+(Open?90:0),TEXT(""),true); }
    for(const auto& V:Rows(Filtered,TEXT("fires"))) { const auto P=V->AsObject(); bool Lit=false; P->TryGetBoolField(TEXT("lit"),Lit); if(Lit) Piece(S(P,TEXT("id")),TEXT("/Engine/BasicShapes/Cone"),Position(P->GetObjectField(TEXT("pos")))*100+FVector(0,0,40),FVector(60,60,80),0,Mat+TEXT("M_TV_LanternPaper"),true); }
}
int32 ATVRegionProjection::InstanceCount() const { int32 Total=0; for(const auto& Pair:Batches) Total+=Pair.Value->GetInstanceCount(); return Total; }
ATVWorldProjection::ATVWorldProjection() { PrimaryActorTick.bCanEverTick=false; }
void ATVWorldProjection::ResetRegions() { for(auto& Pair:Regions) if(Pair.Value) Pair.Value->Destroy(); Regions.Empty(); }
void ATVWorldProjection::Apply(const TSharedPtr<FJsonObject>& Frame,const FVector& Origin) {
    const double Start=FPlatformTime::Seconds();
    for(const auto& V:Rows(Frame,TEXT("unload"))) { const FString Id=V->AsString(); if(auto* P=Regions.FindRef(Id).Get()) P->Destroy(); Regions.Remove(Id); }
    for(auto& Pair:Regions) Pair.Value->SetActorLocation(FVector(Pair.Value->CanonicalBase.X-Origin.X,Pair.Value->CanonicalBase.Y-Origin.Z,-Origin.Y)*100);
    for(const auto& V:Rows(Frame,TEXT("regions"))) { const auto R=V->AsObject(); const FString Id=S(R,TEXT("id")); if(auto* Old=Regions.FindRef(Id).Get()) Old->Destroy();
        const auto B=R->GetObjectField(TEXT("bounds")); auto* P=GetWorld()->SpawnActor<ATVRegionProjection>(FVector(N(B,TEXT("x0"))-Origin.X,N(B,TEXT("z0"))-Origin.Z,-Origin.Y)*100,FRotator::ZeroRotator); P->Build(R); Regions.Add(Id,P); }
    const FString DynamicRegion=S(Frame,TEXT("dynamicRegion"));
    const TSharedPtr<FJsonObject>* Dynamic=nullptr; if(Frame->TryGetObjectField(TEXT("dynamic"),Dynamic)) for(auto& Pair:Regions) if(DynamicRegion.IsEmpty() || Pair.Key==DynamicRegion) Pair.Value->UpdateDynamic(*Dynamic);
    if(Dynamic && Dynamic->IsValid()) { const TSharedPtr<FJsonObject>* Weather; if((*Dynamic)->TryGetObjectField(TEXT("environment"),Weather)) { const FString Kind=S(*Weather,TEXT("kind")); const bool Wet=Kind==TEXT("rain")||Kind==TEXT("storm"); const double Hour=FMath::Fmod(N(*Dynamic,TEXT("worldTime"))/3600,24.); for(TActorIterator<ADirectionalLight> It(GetWorld());It;++It) { It->SetActorRotation(FRotator(-FMath::Max(5.,70.*FMath::Sin((Hour-6)/12*PI)),-35,0)); It->GetLightComponent()->SetIntensity(Hour>6&&Hour<20?(Wet?3000:12000):100); } for(TActorIterator<AExponentialHeightFog> It(GetWorld());It;++It) It->GetComponent()->SetFogDensity(Wet?.025f:.008f); } }
    LastFrameMilliseconds=(FPlatformTime::Seconds()-Start)*1000;
    UE_LOG(LogTemp,Display,TEXT("TV_STREAM %s"),*Metrics());
}
FString ATVWorldProjection::Metrics() const { int32 Total=0,Decorative=0; for(const auto& Pair:Regions) { Total+=Pair.Value->InstanceCount(); Decorative+=Pair.Value->DecorativeCount; } return FString::Printf(TEXT("regions=%d instances=%d pcg_points=%d frame_ms=%.2f process_MB=%.0f"),Regions.Num(),Total,Decorative,LastFrameMilliseconds,FPlatformMemory::GetStats().UsedPhysical/1048576.); }
