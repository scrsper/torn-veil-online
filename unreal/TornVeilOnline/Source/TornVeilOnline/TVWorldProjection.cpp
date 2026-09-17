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
#include "TVFixturePresentation.h"

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
        else if(auto* Wrapper=FTVEnvironmentGrammar::WrapperMaterial(MeshPath)) { for(int32 Slot=0;Slot<Mesh->GetStaticMaterials().Num();++Slot) Batch->SetMaterial(Slot,Wrapper); }
        else for(int32 Slot=0;Slot<Mesh->GetStaticMaterials().Num();++Slot) if(auto* Safe=FTVEnvironmentGrammar::InstancingMaterial(Mesh->GetMaterial(Slot))) Batch->SetMaterial(Slot,Safe);
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
    if(S(P,TEXT("type"))==TEXT("well")) {
        const FString Well=FTVEnvironmentGrammar::Asset(TEXT("Community.Well"),TEXT(""));
        if(!Well.IsEmpty()) Piece(Id,Well,FVector(X+W/2,Y+D/2,Z+160),FVector(350,350,320));
        return;
    }
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
    const FString Type=S(P,TEXT("type"));
    // Two-tier timber-frame grammar: a ground storey carrying the canonical door and windows,
    // and a timber-grid upper band. Stretched single-storey plaster read as a placeholder box.
    const float Storey=FMath::Min(H,320.f);
    const bool bUpper=H>Storey+40;
    if(Indoor) for(int Side=0;Side<4;Side++) {
        const bool AlongX=Side<2; const double Length=AlongX?W:D, Fixed=Side==0?Y:Side==1?Y+D:Side==2?X:X+W;
        const double Out=(Side==0||Side==2)?-1:1;
        const bool DoorSide=AlongX?FMath::Abs(DoorPos.Y-Fixed)<160:FMath::Abs(DoorPos.X-Fixed)<160;
        const double DoorCenter=AlongX?DoorPos.X+50-X:DoorPos.Y+50-Y;
        if(DoorSide && Type==TEXT("smithy")) continue;
        const auto At=[&](double Along,double Height,double Outward=0){ return AlongX?FVector(X+Along,Fixed+Out*Outward,Z+Height):FVector(Fixed+Out*Outward,Y+Along,Z+Height); };
        TArray<TPair<double,double>> Spans;
        if(DoorSide && DoorCenter>0 && DoorCenter<Length) {
            Spans.Add({0,FMath::Max(0.,DoorCenter-65)}); Spans.Add({FMath::Min(Length,DoorCenter+65),Length});
            Piece(Id,Kit+TEXT("DoorFrame_Flat_WoodDark"),At(DoorCenter,118,4),FVector(150,30,236),AlongX?0:90);
            Piece(Id,FTVEnvironmentGrammar::Asset(TEXT("Architecture.Wall"),*(Kit+TEXT("Wall_Plaster_Straight"))),At(DoorCenter,236+(Storey-236)/2),FVector(130,25,Storey-236),AlongX?0:90);
        } else Spans.Add({0,Length});
        for(const auto& Span:Spans) {
            const double SpanLength=Span.Value-Span.Key; if(SpanLength<10) continue;
            const int Count=FMath::Max(1,FMath::CeilToInt(SpanLength/260)); const double Segment=SpanLength/Count;
            for(int I=0;I<Count;I++) {
                const double Offset=Span.Key+(I+.5)*Segment;
                const bool Window=Segment>170 && Random.RandRange(0,2)==0;
                const FString Lower=FTVEnvironmentGrammar::Asset(Window?TEXT("Architecture.Window"):TEXT("Architecture.Wall"),*(Kit+(Window?TEXT("Wall_Plaster_Window_Wide_Flat"):TEXT("Wall_Plaster_Straight"))));
                Piece(Id,Lower,At(Offset,Storey/2),FVector(Segment,25,Storey),AlongX?0:90);
                if(bUpper) {
                    // The timber grid is an open frame; a plaster infill behind it keeps the upper storey solid.
                    Piece(Id,FTVEnvironmentGrammar::Asset(TEXT("Workshop.Wall"),*(Kit+TEXT("Wall_Plaster_WoodGrid"))),At(Offset,Storey+(H-Storey)/2,2),FVector(Segment,25,H-Storey),AlongX?0:90);
                    Piece(Id,FTVEnvironmentGrammar::Asset(TEXT("Architecture.Wall"),*(Kit+TEXT("Wall_Plaster_Straight"))),At(Offset,Storey+(H-Storey)/2,-9),FVector(Segment,22,H-Storey),AlongX?0:90);
                }
            }
            // Brick plinth on the outer face: the building sits on a footing, not on the grass.
            Piece(Id,Kit+TEXT("Floor_Brick"),At(Span.Key+SpanLength/2,26,16),FVector(SpanLength+(Span.Key<1||Span.Value>Length-1?30:0),18,62),AlongX?0:90);
        }
        // Storey beam and wall plate tie the frame together along the whole side.
        if(bUpper) Piece(Id,Kit+TEXT("Roof_Support2"),At(Length/2,Storey,14),FVector(Length+30,16,22),AlongX?0:90);
        Piece(Id,Kit+TEXT("Roof_Support2"),At(Length/2,H-10,14),FVector(Length+30,16,20),AlongX?0:90);
    }
    if(Indoor) {
        // Warm interior fill sized to the room; lanterns add their own local light.
        const int32 LampCount=FMath::Clamp(FMath::RoundToInt(W*D/650000.),1,3);
        for(int32 I=0;I<LampCount;++I) {
            const bool Long=W>=D; const double T=(I+.5)/LampCount;
            Lamp(FVector(Long?X+W*T:X+W/2,Long?Y+D/2:Y+D*T,Z+H-70),1500,FMath::Max(W,D)*1.2f);
        }
    }
    // The target box is grounded at canonical y0; Piece() compensates the source pivot from
    // measured mesh bounds, so these supports meet the plinth/floor rather than floating.
    for(int Corner=0;Corner<4;Corner++)
        Piece(Id,Kit+TEXT("Roof_Support2"),FVector(X+(Corner%2?W:0),Y+(Corner<2?0:D),Z+H/2),FVector(32,32,H+8));
    const FString Envelope=FTVEnvironmentGrammar::Asset(TEXT("Architecture.RoofEnvelope"),TEXT(""));
    if(!Envelope.IsEmpty()) {
        const float Rise=FMath::Min(W,D)*.40f;
        // Source has a Y-aligned ridge; normalize its bounds to a modest overhang.
        Piece(Id,Envelope,FVector(X+W/2,Y+D/2,Z+H+Rise/2-5),
            FVector(FMath::Min(W,D)+70,FMath::Max(W,D)+60,Rise),W>=D?90:0,FTVEnvironmentGrammar::Asset(TEXT("Architecture.RoofEnvelope.Material"),TEXT("")));
        if(Indoor) {
            // Close both gable triangles behind the roof boards; an open gable reads as a hollow shell.
            const bool RidgeX=W>=D; const double Span=RidgeX?D:W;
            for(int End=0;End<2;++End) {
                const FVector Gable=RidgeX?FVector(X+(End?W-6:6),Y+D/2,Z+H+Rise/2-8):FVector(X+W/2,Y+(End?D-6:6),Z+H+Rise/2-8);
                Piece(Id,FTVEnvironmentGrammar::Asset(TEXT("Architecture.Gable"),*(Kit+TEXT("Roof_Front_Brick4"))),Gable,FVector(Span,20,Rise),RidgeX?90:0,FTVEnvironmentGrammar::Asset(TEXT("Architecture.Gable.Material"),TEXT("")));
            }
            // Hearth chimney for homes, taverns and bakeries: a lived-in silhouette above the ridge.
            if(Family==TEXT("dwelling") || Type==TEXT("tavern") || Type==TEXT("bakery")) {
                const double Along=(Random.RandRange(0,1)?.24:.76);
                const FVector Base=RidgeX?FVector(X+W*Along,Y+D/2+40,0):FVector(X+W/2+40,Y+D*Along,0);
                const float Top=Z+H+Rise+110;
                const FString Stone=FTVEnvironmentGrammar::Asset(TEXT("Architecture.Chimney"),TEXT("/Game/Fab/Free_Medieval_Environment_Props_Collection/Medieval1_fbx_StoneWallBlock"));
                Piece(Id,Stone,FVector(Base.X,Base.Y,(Z+H-40+Top)/2),FVector(95,95,Top-(Z+H-40)));
                Piece(Id,Stone,FVector(Base.X,Base.Y,Top+10),FVector(125,125,20));
            }
        }
    } else {
        const FString Roof=FTVEnvironmentGrammar::Asset(TEXT("Architecture.RoofSlope"),*(Kit+TEXT("Roof_Wooden_2x1")));
        for(const auto& Panel:FTVEnvironmentGrammar::Roof(FVector(X,Y,Z),FVector2D(W,D),H)) Piece(Id,Roof,Panel.Center,Panel.Size,Panel.Yaw);
    }
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
    // Ground layers from canonical places: trampled work yards and door aprons (R), paving under
    // the shared square (A), and woodland floor only away from the settlement (B).
    struct FGroundYard { FBox2D Box; float Worn; bool bPaved; };
    TArray<FGroundYard> Yards; TArray<FVector2D> Doors; TArray<FBox2D> SettlementBoxes;
    for(const auto& V:Rows(R,TEXT("places"))) { const auto P=V->AsObject(); const auto PB=P->GetObjectField(TEXT("bounds")); const FString Type=S(P,TEXT("type"));
        const FBox2D Box(FVector2D(N(PB,TEXT("x0")),N(PB,TEXT("z0"))),FVector2D(N(PB,TEXT("x1"))+1,N(PB,TEXT("z1"))+1));
        if(Type==TEXT("square")||Type==TEXT("well")||Type==TEXT("stall")||Type==TEXT("sawpit")||Type==TEXT("quarry")) Yards.Add({Box,Type==TEXT("quarry")?.7f:.85f,Type==TEXT("square")});
        const TSharedPtr<FJsonObject>* Door; if(P->TryGetObjectField(TEXT("door"),Door)) Doors.Add(FVector2D(N(*Door,TEXT("x"))+.5,N(*Door,TEXT("z"))+.5)); }
    for(const auto& V:Rows(R,TEXT("settlements"))) { const auto SB=V->AsObject()->GetObjectField(TEXT("bounds")); SettlementBoxes.Add(FBox2D(FVector2D(N(SB,TEXT("x0")),N(SB,TEXT("z0"))),FVector2D(N(SB,TEXT("x1")),N(SB,TEXT("z1"))))); }
    const auto BoxDistance=[](const FBox2D& Box,const FVector2D& P){ const double DX=FMath::Max3(Box.Min.X-P.X,P.X-Box.Max.X,0.), DY=FMath::Max3(Box.Min.Y-P.Y,P.Y-Box.Max.Y,0.); return FMath::Sqrt(DX*DX+DY*DY); };
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
        // Preserve the world tile phase without huge UV values: material interpolators
        // can use half precision, which quantizes absolute kilometre coordinates.
        UV.Add(FVector2D(LX+FMath::Fmod(CanonicalBase.X,4.),LY+FMath::Fmod(CanonicalBase.Y,4.))/4.);
        float Worn=FTVEnvironmentGrammar::WornGround(XY,PathCells,Routes), Paving=0;
        for(const auto& Yard:Yards) { const double Distance=BoxDistance(Yard.Box,XY); Worn=FMath::Max(Worn,Yard.Worn*(1-FMath::SmoothStep(0.f,2.5f,static_cast<float>(Distance))));
            if(Yard.bPaved) Paving=FMath::Max(Paving,1-FMath::SmoothStep(0.f,1.6f,static_cast<float>(Distance))); }
        for(const auto& Door:Doors) Worn=FMath::Max(Worn,.8f*(1-FMath::SmoothStep(1.2f,3.4f,static_cast<float>(FVector2D::Distance(Door,XY)))));
        double Edge=1e6; for(const auto& Box:SettlementBoxes) Edge=FMath::Min(Edge,Box.IsInside(XY)?-1.:BoxDistance(Box,XY));
        const float Woodland=static_cast<float>(C[5]->AsNumber())*FMath::SmoothStep(10.f,45.f,static_cast<float>(Edge));
        Colors.Add(FLinearColor(Worn,C[3]->AsNumber()==16?1:0,Woodland,Paving)); }
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
    for(const auto& V:Rows(R,TEXT("furnishings"))) {
        const auto F=V->AsObject(); const FVector Base=Position(F->GetObjectField(TEXT("pos")))*100+FVector(50,50,0);
        const float Yaw=N(F,TEXT("yaw")); const FQuat Rotation=FRotator(0,Yaw,0).Quaternion();
        const FString Id=FString::Printf(TEXT("fixture:%.0f:%.0f:%.0f"),Base.X,Base.Y,Base.Z);
        for(const auto& Part:FTVFixturePresentation::Describe(S(F,TEXT("role"))))
            Piece(Id,FTVEnvironmentGrammar::Asset(*Part.MeshRole,*Part.FallbackMesh),Base+Rotation.RotateVector(Part.CenterOffsetCm),Part.SizeCm,Yaw+Part.Yaw,
                FTVEnvironmentGrammar::Asset(*Part.MaterialRole,TEXT("")));
        // Canonical lanterns and hearths are the room's real light sources.
        if(S(F,TEXT("role"))==TEXT("lantern")) Lamp(Base+FVector(0,0,70),320,800);
        else if(S(F,TEXT("role"))==TEXT("forge")) Lamp(Base+FVector(0,0,90),400,900,FLinearColor(1,.55,.25));
    }
    DressPlaces(R);
    for(const auto& F:Rows(R,TEXT("fences"))) { const auto& C=F->AsArray(); Piece(TEXT("fence"),FTVEnvironmentGrammar::Asset(TEXT("Boundary.Fence"),*(Kit+TEXT("Balcony_Simple_Straight"))),FVector(C[0]->AsNumber()+.5,C[2]->AsNumber()+.5,C[1]->AsNumber()+.5)*100,FVector(100,18,100),C.Num()>3?C[3]->AsNumber():0,FTVEnvironmentGrammar::Asset(TEXT("Boundary.Fence.Material"),TEXT(""))); }
    for(const auto& V:Columns) { const auto& C=V->AsArray(); if(C[4]->AsNumber()>=0) Piece(TEXT("water"),TEXT("/Engine/BasicShapes/Cube"),FVector(C[0]->AsNumber(),C[1]->AsNumber(),C[4]->AsNumber())*100,FVector(N(R->GetObjectField(TEXT("terrain")),TEXT("stride"),8)*100,N(R->GetObjectField(TEXT("terrain")),TEXT("stride"),8)*100,5),0,Mat+TEXT("M_TV_RiverWater"));
    }
    Dress(R); Woodland(R); BuildMilliseconds=(FPlatformTime::Seconds()-Start)*1000;
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
        // Normalize by actual mesh bounds: imported grass units vary by an order
        // of magnitude. Keep ground cover at 20–45cm without altering support.
        const float Scale=(20.f+Random.FRand()*25.f)/FMath::Max(Grass?Grass->GetBoundingBox().GetSize().Z:100.,1.);
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
        if(Tree && Available) {
            const bool Variant=GetTypeHash(Id)%2;
            const FString TreeMesh=FTVEnvironmentGrammar::Asset(Variant?TEXT("Vegetation.Tree.A"):TEXT("Vegetation.Tree.B"),TEXT("/Game/ThirdParty/Quaternius/Nature/CommonTree_1"));
            // Uniform scale by measured height: a squashed canopy reads as a placeholder.
            const auto* Mesh=LoadObject<UStaticMesh>(nullptr,*TreeMesh); const FVector Ext=Mesh?Mesh->GetBoundingBox().GetSize():FVector(100);
            // Natural-size local trees match the surrounding woodland; small legacy meshes keep 6.5-9 m.
            const float Height=Ext.Z>600?Ext.Z*(.75f+(GetTypeHash(Id)%30)/100.f):650.f+(GetTypeHash(Id)%250), Scale=Height/FMath::Max(Ext.Z,1.);
            Piece(Id,TreeMesh,Pos+FVector(50,50,Height/2-15),Ext*Scale,GetTypeHash(Id)%360,TEXT(""),true);
        }
        else if(Tree) Piece(Id,Kit+TEXT("Roof_Support2"),Pos+FVector(50,50,20),FVector(65,65,40),0,TEXT(""),true);
        else if(Available) Piece(Id,FTVEnvironmentGrammar::Asset(TEXT("Environment.Rock"),TEXT("/Game/ThirdParty/Quaternius/Nature/Rock_1")),Pos+FVector(50,50,50),FVector(100,100,100),GetTypeHash(Id)%360,TEXT(""),true);
    }
    for(const auto& V:Rows(Filtered,TEXT("crops"))) { const auto P=V->AsObject(); const FString State=S(P,TEXT("state")); if(State==TEXT("fallow")||State==TEXT("harvested")) continue;
        // Crop growth reads as plant size on the canonical plot; no cone placeholders.
        const float H=State==TEXT("mature")?80:18+N(P,TEXT("growth"))*55; const FString Id=S(P,TEXT("id"));
        const FString Crop=FTVEnvironmentGrammar::Asset(TEXT("Crop.Plant"),TEXT("/Game/AdvancedVillagePack/Meshes/SM_Plant"));
        const auto* CropMesh=LoadObject<UStaticMesh>(nullptr,*Crop); const FVector CropExt=CropMesh?CropMesh->GetBoundingBox().GetSize():FVector(24,24,H);
        Piece(Id,Crop,Position(P->GetObjectField(TEXT("pos")))*100+FVector(50,50,H/2),CropExt*(H/FMath::Max(CropExt.Z,1.)),GetTypeHash(Id)%360,TEXT(""),true); }
    for(const auto& V:Rows(Filtered,TEXT("items"))) { const auto P=V->AsObject();const auto D=FTVItemPresentationCatalog::Describe(S(P,TEXT("type")));Piece(S(P,TEXT("id")),D.MeshPath,Position(P->GetObjectField(TEXT("pos")))*100+FVector(0,0,D.HeightOffset),D.Size,D.Yaw,TEXT(""),true); }
    for(const auto& V:Rows(Filtered,TEXT("containers"))) { const auto P=V->AsObject();bool Open=false;P->TryGetBoolField(TEXT("open"),Open);const auto D=FTVItemPresentationCatalog::DescribeContainer(Open);
        Piece(S(P,TEXT("id")),FTVEnvironmentGrammar::Asset(Open?TEXT("Storage.Open"):TEXT("Storage.Closed"),*D.MeshPath),Position(P->GetObjectField(TEXT("pos")))*100+FVector(0,0,D.HeightOffset),D.Size,0,TEXT(""),true); }
    for(const auto& V:Rows(Filtered,TEXT("mechanisms"))) { const auto P=V->AsObject(); const FVector Pos=Position(P->GetObjectField(TEXT("pos")))*100; for(int I=0;I<N(P,TEXT("parts"));I++) Piece(S(P,TEXT("id")),Kit+TEXT("Roof_Support2"),Pos+FVector(I*25,0,60),FVector(20,50,120),N(P,TEXT("condition"),1)<.5?20:FMath::Fmod(N(P,TEXT("operatedSeconds"))*90,360),TEXT(""),true); }
    for(const auto& V:Rows(Filtered,TEXT("construction"))) { const auto P=V->AsObject(); if(S(P,TEXT("state"))==TEXT("complete")) continue; const auto B=P->GetObjectField(TEXT("bounds")); const float H=50+200*N(P,TEXT("progress")); for(int I=0;I<4;I++) Piece(S(P,TEXT("id")),Kit+TEXT("Roof_Support2"),FVector(N(B,I%2?TEXT("x1"):TEXT("x0"))*100,N(B,I<2?TEXT("z0"):TEXT("z1"))*100,N(B,TEXT("y0"))*100+H/2),FVector(25,25,H),0,TEXT(""),true); }
    for(const auto& V:Rows(Filtered,TEXT("doors"))) { const auto P=V->AsObject(); bool Open=false; P->TryGetBoolField(TEXT("open"),Open);
        // An open leaf swings about its hinge to the jamb instead of standing across the doorway.
        const float Yaw=N(P,TEXT("yaw")); const FVector Along=FRotator(0,Yaw,0).Vector(), Across=FRotator(0,Yaw+90,0).Vector();
        const FVector Center=Position(P->GetObjectField(TEXT("pos")))*100+FVector(50,50,100)+(Open?-Along*44+Across*44:FVector::ZeroVector);
        Piece(S(P,TEXT("id")),Kit+TEXT("Door_1_Flat"),Center,FVector(100,12,200),Yaw+(Open?90:0),TEXT(""),true); }
    for(const auto& V:Rows(Filtered,TEXT("fires"))) { const auto P=V->AsObject(); bool Lit=false; P->TryGetBoolField(TEXT("lit"),Lit); if(Lit) Piece(S(P,TEXT("id")),TEXT("/Engine/BasicShapes/Cone"),Position(P->GetObjectField(TEXT("pos")))*100+FVector(0,0,40),FVector(60,60,80),0,Mat+TEXT("M_TV_LanternPaper"),true); }
}
int32 ATVRegionProjection::InstanceCount() const { int32 Total=0; for(const auto& Pair:Batches) Total+=Pair.Value->GetInstanceCount(); return Total; }
ATVWorldProjection::ATVWorldProjection() { PrimaryActorTick.bCanEverTick=false; FTVEnvironmentGrammar::ReloadPalette(); }
void ATVWorldProjection::ResetRegions() { for(auto& Pair:Regions) if(Pair.Value) Pair.Value->Destroy(); Regions.Empty(); if(Vista) Vista->Destroy(); Vista=nullptr; }
void ATVWorldProjection::Apply(const TSharedPtr<FJsonObject>& Frame,const FVector& Origin) {
    const double Start=FPlatformTime::Seconds();
    for(const auto& V:Rows(Frame,TEXT("unload"))) { const FString Id=V->AsString(); if(auto* P=Regions.FindRef(Id).Get()) P->Destroy(); Regions.Remove(Id); }
    for(auto& Pair:Regions) Pair.Value->SetActorLocation(FVector(Pair.Value->CanonicalBase.X-Origin.X,Pair.Value->CanonicalBase.Y-Origin.Z,-Origin.Y)*100);
    for(const auto& V:Rows(Frame,TEXT("regions"))) { const auto R=V->AsObject(); const FString Id=S(R,TEXT("id")); if(auto* Old=Regions.FindRef(Id).Get()) Old->Destroy();
        const auto B=R->GetObjectField(TEXT("bounds")); auto* P=GetWorld()->SpawnActor<ATVRegionProjection>(FVector(N(B,TEXT("x0"))-Origin.X,N(B,TEXT("z0"))-Origin.Z,-Origin.Y)*100,FRotator::ZeroRotator); P->Build(R); Regions.Add(Id,P); }
    const TSharedPtr<FJsonObject>* VistaData=nullptr;
    if(Frame->TryGetObjectField(TEXT("vista"),VistaData)) { if(!Vista) Vista=GetWorld()->SpawnActor<ATVVistaProjection>(); Vista->Build(*VistaData); }
    if(Vista) Vista->SetActorLocation(FVector(Vista->CanonicalBase.X-Origin.X,Vista->CanonicalBase.Y-Origin.Z,-Origin.Y)*100);
    const FString DynamicRegion=S(Frame,TEXT("dynamicRegion"));
    const TSharedPtr<FJsonObject>* Dynamic=nullptr; if(Frame->TryGetObjectField(TEXT("dynamic"),Dynamic)) for(auto& Pair:Regions) if(DynamicRegion.IsEmpty() || Pair.Key==DynamicRegion) Pair.Value->UpdateDynamic(*Dynamic);
    // v0.1 deliberately uses neutral daylight at every saved clock value. The previous
    // 100-lux night switch combined with fixed EV100 12 made ordinary resumed PIE black.
    // Canonical time/weather remain untouched; a complete day/night exposure rig is deferred.
    if(Dynamic && Dynamic->IsValid()) { const TSharedPtr<FJsonObject>* Weather; if((*Dynamic)->TryGetObjectField(TEXT("environment"),Weather)) { const FString Kind=S(*Weather,TEXT("kind")); const bool Wet=Kind==TEXT("rain")||Kind==TEXT("storm"); for(TActorIterator<AExponentialHeightFog> It(GetWorld());It;++It) It->GetComponent()->SetFogDensity(Wet?.03f:.014f); } }
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
