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
#include "Engine/ExponentialHeightFog.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "TVItemPresentationCatalog.h"
#include "TVEnvironmentGrammar.h"

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
    // Keep the canonical footprint and y0 untouched, but give streamed dwellings the same
    // grounded assembly language as the audited 6x8 PCG recipe: a shallow brick plinth under
    // the floor absorbs pivot/bounds variation without inventing collision or terrain.
    if (Indoor) Piece(Id,Kit+TEXT("Floor_Brick"),FVector(X+W/2,Y+D/2,Z-28),FVector(W+20,D+20,32));
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
                // Window modules are presentation-only openings selected per deterministic
                // visual seed; the canonical door/opening facts remain the authority.
                const bool Window=Random.RandRange(0,2)==0;
                const FString Wall=FTVEnvironmentGrammar::Asset(Window?TEXT("Architecture.Window"):Family==TEXT("workshop")?TEXT("Workshop.Wall"):TEXT("Architecture.Wall"),
                    *(Kit+(Window?TEXT("Wall_Plaster_Window_Wide_Flat"):Family==TEXT("workshop")?TEXT("Wall_Plaster_WoodGrid"):TEXT("Wall_Plaster_Straight"))));
                Piece(Id,Wall,C,FVector(Segment,25,H),AlongX?0:90); }
        }
    }
    // The target box is grounded at canonical y0; Piece() compensates the source pivot from
    // measured mesh bounds, so these supports meet the plinth/floor rather than floating.
    for(int Corner=0;Corner<4;Corner++)
        Piece(Id,Kit+TEXT("Roof_Support2"),FVector(X+(Corner%2?W:0),Y+(Corner<2?0:D),Z+H/2),FVector(25,25,H));
    const FString Roof=FTVEnvironmentGrammar::Asset(TEXT("Architecture.RoofSlope"),*(Kit+TEXT("Roof_Wooden_2x1")));
    for(const auto& Panel:FTVEnvironmentGrammar::Roof(FVector(X,Y,Z),FVector2D(W,D),H))
        Piece(Id,Roof,Panel.Center,Panel.Size,Panel.Yaw);
    // A boarded ceiling closes the visible roof underside without changing walkable space.
    if(Indoor) Piece(Id,Kit+TEXT("Floor_WoodDark"),FVector(X+W/2,Y+D/2,Z+H-8),FVector(W,D,12));
    // Equipment comes from assemblies, never from a decorative building family.
}
void ATVRegionProjection::Build(const TSharedPtr<FJsonObject>& R) {
    const double Start=FPlatformTime::Seconds(); RegionId=S(R,TEXT("id")); const auto B=R->GetObjectField(TEXT("bounds")); CanonicalBase=FVector(N(B,TEXT("x0")),N(B,TEXT("z0")),0);
    TArray<FVector> Vertices,Normals; TArray<int32> Triangles; TArray<FVector2D> UV; TArray<FLinearColor> Colors; TArray<FProcMeshTangent> Tangents;
    const auto& Columns=Rows(R->GetObjectField(TEXT("terrain")),TEXT("columns")); const int Side=FMath::RoundToInt(FMath::Sqrt(static_cast<double>(Columns.Num())));
    TSet<FIntPoint> PathCells;
    for(const auto& V:Rows(R,TEXT("paths"))) { const auto& C=V->AsArray(); PathCells.Add(FIntPoint(C[0]->AsNumber(),C[2]->AsNumber())); }
    TArray<FTVSurfaceRoute> Routes;
    for(const auto& Road:Rows(R,TEXT("roads"))) { const auto& Points=Rows(Road->AsObject(),TEXT("points")); for(int I=1;I<Points.Num();I++) {
        const FVector A=Position(Points[I-1]->AsObject()), Bp=Position(Points[I]->AsObject()); Routes.Add({FVector2D(A.X,A.Y),FVector2D(Bp.X,Bp.Y),1.6f}); } }
    // Subdivide only the existing surface triangles. This resolves narrow footpaths in the
    // material without creating new elevation, changing collision or lifting road slabs.
    const double SourceStride=N(R->GetObjectField(TEXT("terrain")),TEXT("stride"),8);
    const int RenderStride=Side>33?1:2, RenderSide=256/RenderStride+1;
    for(int X=0;X<RenderSide;X++) for(int Y=0;Y<RenderSide;Y++) {
        const double LX=X*RenderStride,LY=Y*RenderStride;
        const int IX=FMath::Min(FMath::FloorToInt(LX/SourceStride),Side-2),IY=FMath::Min(FMath::FloorToInt(LY/SourceStride),Side-2);
        const auto& C=Columns[IX*Side+IY]->AsArray(); const auto& CX=Columns[(IX+1)*Side+IY]->AsArray();
        const auto& CY=Columns[IX*Side+IY+1]->AsArray(); const auto& CXY=Columns[(IX+1)*Side+IY+1]->AsArray();
        const double U=LX/SourceStride-IX,V=LY/SourceStride-IY;
        const double A=C[2]->AsNumber(),BX=CX[2]->AsNumber(),CH=CY[2]->AsNumber(),D=CXY[2]->AsNumber();
        const double Height=U+V<=1?A+(BX-A)*U+(CH-A)*V:D+(CH-D)*(1-U)+(BX-D)*(1-V);
        const FVector2D XY(CanonicalBase.X+LX,CanonicalBase.Y+LY);
        Vertices.Add(FVector(LX,LY,Height)*100); Normals.Add(FVector::UpVector);
        UV.Add(XY/4.); // World anchored texture phase across region boundaries.
        Colors.Add(FLinearColor(FTVEnvironmentGrammar::WornGround(XY,PathCells,Routes),C[3]->AsNumber()==16?1:0,C[5]->AsNumber(),1)); }
    for(int X=0;X<RenderSide-1;X++) for(int Y=0;Y<RenderSide-1;Y++) { int A=X*RenderSide+Y, Next=A+RenderSide; Triangles.Append({A,A+1,Next,A+1,Next+1,Next}); }
    // Reconstruct smooth support normals from the canonical sampled surface. The mesh remains
    // presentation-only, but its lighting must communicate the same relief that navigation sees.
    Normals.SetNumZeroed(Vertices.Num());
    for (int32 I = 0; I + 2 < Triangles.Num(); I += 3) {
        const int32 IA = Triangles[I], IB = Triangles[I + 1], IC = Triangles[I + 2];
        FVector Face = FVector::CrossProduct(Vertices[IB] - Vertices[IA], Vertices[IC] - Vertices[IA]);
        if (Face.Z < 0.f) Face *= -1.f;
        Normals[IA] += Face; Normals[IB] += Face; Normals[IC] += Face;
    }
    for (FVector& Normal : Normals) Normal = Normal.IsNearlyZero() ? FVector::UpVector : Normal.GetSafeNormal();
    Terrain->CreateMeshSection_LinearColor(0,Vertices,Triangles,Normals,UV,Colors,Tangents,false);
    auto* Ground=LoadObject<UMaterialInterface>(nullptr,*FTVEnvironmentGrammar::Asset(TEXT("Ground.Settlement"),*(Mat+TEXT("M_TV_PH_Soil"))));
    Terrain->SetMaterial(0,Ground?Ground:LoadObject<UMaterialInterface>(nullptr,*(Mat+TEXT("M_TV_PH_Soil"))));
    for(const auto& P:Rows(R,TEXT("places"))) Structure(P->AsObject());
    for(const auto& F:Rows(R,TEXT("fences"))) { const auto& C=F->AsArray(); Piece(TEXT("fence"),Kit+TEXT("Balcony_Simple_Straight"),FVector(C[0]->AsNumber()+.5,C[2]->AsNumber()+.5,C[1]->AsNumber()+.5)*100,FVector(100,18,100),C.Num()>3?C[3]->AsNumber():0); }
    for(const auto& V:Columns) { const auto& C=V->AsArray(); if(C[4]->AsNumber()>=0) Piece(TEXT("water"),TEXT("/Engine/BasicShapes/Cube"),FVector(C[0]->AsNumber(),C[1]->AsNumber(),C[4]->AsNumber())*100,FVector(N(R->GetObjectField(TEXT("terrain")),TEXT("stride"),8)*100,N(R->GetObjectField(TEXT("terrain")),TEXT("stride"),8)*100,5),0,Mat+TEXT("M_TV_RiverWater"));
    }
    Dress(R); BuildMilliseconds=(FPlatformTime::Seconds()-Start)*1000;
    UE_LOG(LogTemp,Display,TEXT("TV_REGION %s build_ms=%.2f instances=%d pcg_points=%d"),*RegionId,BuildMilliseconds,InstanceCount(),DecorativeCount);
}
void ATVRegionProjection::Dress(const TSharedPtr<FJsonObject>& R) {
    auto* Graph=NewObject<UPCGGraph>(this); UTVPCGSubstrateSettings* Source=nullptr; auto* SourceNode=Graph->AddNodeOfType(Source);
    FRandomStream Random(static_cast<int32>(N(R->GetObjectField(TEXT("decoration")),TEXT("seed"))));
    const FString GrassPath=FTVEnvironmentGrammar::Asset(TEXT("Vegetation.Grass"),TEXT("/Game/ThirdParty/PolyHaven/Meshes/grass_medium_01_1k.grass_medium_01_1k"));
    const auto* Grass=LoadObject<UStaticMesh>(nullptr,*GrassPath);
    const float PivotZ=Grass?Grass->GetBoundingBox().Min.Z:0;
    const auto T=R->GetObjectField(TEXT("terrain")); const auto& Columns=Rows(T,TEXT("columns"));
    const int Side=FMath::RoundToInt(FMath::Sqrt(static_cast<double>(Columns.Num()))); const double Stride=N(T,TEXT("stride"),8);
    TSet<FIntPoint> PathCells; TArray<FTVSurfaceRoute> Routes;
    for(const auto& V:Rows(R,TEXT("paths"))) { const auto& C=V->AsArray(); PathCells.Add(FIntPoint(C[0]->AsNumber(),C[2]->AsNumber())); }
    for(const auto& V:Rows(R,TEXT("roads"))) { const auto& Points=Rows(V->AsObject(),TEXT("points")); for(int I=1;I<Points.Num();I++) {
        const FVector A=Position(Points[I-1]->AsObject()), B=Position(Points[I]->AsObject()); Routes.Add({FVector2D(A.X,A.Y),FVector2D(B.X,B.Y),2.2f}); } }
    const auto& Exclusions=R->HasField(TEXT("dressingExclusions"))?Rows(R,TEXT("dressingExclusions")):Rows(R,TEXT("places"));
    // Small grass clusters, sampled against the same terrain triangles as the ground mesh.
    // Four-metre candidate cells are jittered; no visible eight-metre rows of identical bushes.
    for(int X=0;X<256;X+=4) for(int Y=0;Y<256;Y+=4) for(int Candidate=0;Candidate<3;Candidate++) {
        const double LX=X+Random.FRand()*4, LY=Y+Random.FRand()*4;
        const FVector2D XY(CanonicalBase.X+LX,CanonicalBase.Y+LY);
        const int IX=FMath::Min(FMath::FloorToInt(LX/Stride),Side-2), IY=FMath::Min(FMath::FloorToInt(LY/Stride),Side-2);
        const auto& C=Columns[IX*Side+IY]->AsArray(); const auto& CX=Columns[(IX+1)*Side+IY]->AsArray();
        const auto& CY=Columns[IX*Side+IY+1]->AsArray(); const auto& CXY=Columns[(IX+1)*Side+IY+1]->AsArray();
        const double Block=C[3]->AsNumber();
        if(C[4]->AsNumber()>=0 || CX[4]->AsNumber()>=0 || CY[4]->AsNumber()>=0 || CXY[4]->AsNumber()>=0 || (Block!=1 && Block!=2 && Block!=36)) continue;
        if(FTVEnvironmentGrammar::WornGround(XY,PathCells,Routes)>.03f) continue;
        bool Occupied=false; for(const auto& P:Exclusions) { const auto B=P->AsObject()->GetObjectField(TEXT("bounds"));
            if(XY.X>=N(B,TEXT("x0"))-2 && XY.X<=N(B,TEXT("x1"))+3 && XY.Y>=N(B,TEXT("z0"))-2 && XY.Y<=N(B,TEXT("z1"))+3) {Occupied=true;break;} }
        if(Occupied || Random.FRand()>FMath::Clamp((FTVEnvironmentGrammar::Cluster(XY,0)-.28f)*2.f,.02f,.85f)) continue;
        const double A=C[2]->AsNumber(), B=CX[2]->AsNumber(), CHeight=CY[2]->AsNumber(), D=CXY[2]->AsNumber();
        if(FMath::Max(FMath::Max(A,B),FMath::Max(CHeight,D))-FMath::Min(FMath::Min(A,B),FMath::Min(CHeight,D))>2.) continue;
        const double U=LX/Stride-IX,V=LY/Stride-IY;
        const double Height=U+V<=1?A+(B-A)*U+(CHeight-A)*V:D+(CHeight-D)*(1-U)+(B-D)*(1-V);
        const float Scale=.22f+Random.FRand()*.28f;
        const FVector Support=GetActorLocation()+FVector(LX*100,LY*100,Height*100-PivotZ*Scale);
        Source->Points.Add(FTransform(FRotator(0,Random.FRand()*360,0),Support,FVector(Scale)));
    }
    DecorativeCount=Source->Points.Num(); UPCGStaticMeshSpawnerSettings* Spawner=nullptr; auto* SpawnNode=Graph->AddNodeOfType(Spawner);
    Spawner->SetMeshSelectorType(UPCGMeshSelectorWeighted::StaticClass()); auto* Selector=Cast<UPCGMeshSelectorWeighted>(Spawner->MeshSelectorParameters);
    FPCGMeshSelectorWeightedEntry Entry; Entry.Descriptor.StaticMesh=TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(GrassPath)); Entry.Descriptor.bUseDefaultCollision=false; Entry.Descriptor.BodyInstance.SetCollisionProfileName(TEXT("NoCollision")); Entry.Descriptor.InstanceStartCullDistance=4500; Entry.Descriptor.InstanceEndCullDistance=9000; Entry.Weight=1; Selector->MeshEntries.Add(Entry);
    Graph->AddEdge(SourceNode,PCGPinConstants::DefaultOutputLabel,SpawnNode,PCGPinConstants::DefaultInputLabel);
    Graph->AddEdge(SpawnNode,PCGPinConstants::DefaultOutputLabel,Graph->GetOutputNode(),PCGPinConstants::DefaultOutputLabel);
    Dressing->ComponentTags.Add(TEXT("TV.Decorative.NoGameplay")); Dressing->SetGraph(Graph); PCGStarted=FPlatformTime::Seconds(); Dressing->GenerateLocal(true);
}
void ATVRegionProjection::PCGFinished(UPCGComponent* Component) { PCGMilliseconds=(FPlatformTime::Seconds()-PCGStarted)*1000; UE_LOG(LogTemp,Display,TEXT("TV_PCG %s wall_ms=%.2f points=%d"),*RegionId,PCGMilliseconds,DecorativeCount); }
void ATVRegionProjection::UpdateDynamic(const TSharedPtr<FJsonObject>& Data) {
    const auto InRegion=[this](const FVector& P) { return P.X>=CanonicalBase.X && P.X<CanonicalBase.X+256 && P.Y>=CanonicalBase.Y && P.Y<CanonicalBase.Y+256; };
    auto Filtered=MakeShared<FJsonObject>();
    for(const auto Key:{TEXT("resources"),TEXT("items"),TEXT("containers"),TEXT("crops"),TEXT("mechanisms"),TEXT("doors"),TEXT("fires"),TEXT("construction")}) { TArray<TSharedPtr<FJsonValue>> A; for(const auto& V:Rows(Data,Key)) if(InRegion(Position(V->AsObject()->GetObjectField(TEXT("pos"))))) A.Add(V); Filtered->SetArrayField(Key,A); }
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
    for(const auto& V:Rows(Filtered,TEXT("items"))) { const auto P=V->AsObject();const auto D=FTVItemPresentationCatalog::Describe(S(P,TEXT("type")));Piece(S(P,TEXT("id")),D.MeshPath,Position(P->GetObjectField(TEXT("pos")))*100+FVector(0,0,D.HeightOffset),D.Size,D.Yaw,TEXT(""),true); }
    for(const auto& V:Rows(Filtered,TEXT("containers"))) { const auto P=V->AsObject();bool Open=false;P->TryGetBoolField(TEXT("open"),Open);const auto D=FTVItemPresentationCatalog::DescribeContainer(Open);Piece(S(P,TEXT("id")),D.MeshPath,Position(P->GetObjectField(TEXT("pos")))*100+FVector(0,0,D.HeightOffset),D.Size,0,Mat+TEXT("M_TV_CharacterCloth"),true); }
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
    // v0.1 deliberately uses neutral daylight at every saved clock value. The previous
    // 100-lux night switch combined with fixed EV100 12 made ordinary resumed PIE black.
    // Canonical time/weather remain untouched; a complete day/night exposure rig is deferred.
    if(Dynamic && Dynamic->IsValid()) { const TSharedPtr<FJsonObject>* Weather; if((*Dynamic)->TryGetObjectField(TEXT("environment"),Weather)) { const FString Kind=S(*Weather,TEXT("kind")); const bool Wet=Kind==TEXT("rain")||Kind==TEXT("storm"); for(TActorIterator<AExponentialHeightFog> It(GetWorld());It;++It) It->GetComponent()->SetFogDensity(Wet?.025f:.008f); } }
    LastFrameMilliseconds=(FPlatformTime::Seconds()-Start)*1000;
    UE_LOG(LogTemp,Display,TEXT("TV_STREAM %s"),*Metrics());
}
FString ATVWorldProjection::Metrics() const { int32 Total=0,Decorative=0; for(const auto& Pair:Regions) { Total+=Pair.Value->InstanceCount(); Decorative+=Pair.Value->DecorativeCount; } return FString::Printf(TEXT("regions=%d instances=%d pcg_points=%d frame_ms=%.2f process_MB=%.0f"),Regions.Num(),Total,Decorative,LastFrameMilliseconds,FPlatformMemory::GetStats().UsedPhysical/1048576.); }
bool ATVRegionProjection::FindVisualBounds(const FString& CanonicalId, FBox& OutBounds) const {
    OutBounds = FBox(EForceInit::ForceInit);
    bool bFound = false;
    const TArray<FString>* Keys = CanonicalVisuals.Find(CanonicalId); if (!Keys) return false;
    for (const FString& Key : *Keys) {
            FString BatchKey, IndexText;
            if (!Key.Split(TEXT("#"), &BatchKey, &IndexText)) continue;
            const int32 Index = FCString::Atoi(*IndexText);
            const TObjectPtr<UHierarchicalInstancedStaticMeshComponent>* Found = Batches.Find(BatchKey); if (!Found || !Found->Get()) continue;
            FTransform Transform; if (!(*Found)->GetInstanceTransform(Index, Transform, true)) continue;
            OutBounds += (*Found)->GetStaticMesh()->GetBoundingBox().TransformBy(Transform);
            bFound = true;
    }
    return bFound;
}
bool ATVWorldProjection::FindVisualBounds(const FString& CanonicalId, FBox& OutBounds) const {
    OutBounds = FBox(EForceInit::ForceInit);
    bool bFound = false;
    for (const auto& Pair : Regions) {
        FBox RegionBounds(EForceInit::ForceInit);
        if (Pair.Value && Pair.Value->FindVisualBounds(CanonicalId, RegionBounds)) { OutBounds += RegionBounds; bFound = true; }
    }
    return bFound;
}
