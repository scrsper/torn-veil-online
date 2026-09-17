// Woodland zoning and the far horizon. Both are decorative presentation derived from canonical
// facts already streamed to the client (forest density, surface class, settlement/place bounds,
// paths and roads). Nothing here collides, owns an identity or reaches the simulation.
#include "TVWorldProjection.h"
#include "TVEnvironmentGrammar.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "ProceduralMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInterface.h"
#include "Dom/JsonObject.h"

namespace
{
    double Num(const TSharedPtr<FJsonObject>& P, const TCHAR* Key, double Default = 0) { double V; return P->TryGetNumberField(Key, V) ? V : Default; }
    const TArray<TSharedPtr<FJsonValue>>& List(const TSharedPtr<FJsonObject>& P, const TCHAR* Key) { static TArray<TSharedPtr<FJsonValue>> Empty; const TArray<TSharedPtr<FJsonValue>>* A; return P->TryGetArrayField(Key, A) ? *A : Empty; }

    /** Stable per world cell, so neighbouring regions and reloads agree on every placement. */
    float Hash01(int32 X, int32 Y, int32 Salt)
    {
        uint32 H = HashCombineFast(HashCombineFast(GetTypeHash(X), GetTypeHash(Y * 7919)), GetTypeHash(Salt * 104729));
        H ^= H >> 15; H *= 0x2c1b3c6dU; H ^= H >> 12; H *= 0x297a2d39U; H ^= H >> 15;
        return (H & 0xFFFFFF) / 16777215.f;
    }

    struct FRect { double X0, Y0, X1, Y1; };
    FRect Bounds(const TSharedPtr<FJsonObject>& B) { return { Num(B, TEXT("x0")), Num(B, TEXT("z0")), Num(B, TEXT("x1")) + 1, Num(B, TEXT("z1")) + 1 }; }
    /** Negative inside the rectangle. */
    double SignedDistance(const FRect& R, double X, double Y)
    {
        const double DX = FMath::Max(R.X0 - X, X - R.X1), DY = FMath::Max(R.Y0 - Y, Y - R.Y1);
        if (DX <= 0 && DY <= 0) return FMath::Max(DX, DY);
        return FMath::Sqrt(FMath::Square(FMath::Max(DX, 0.)) + FMath::Square(FMath::Max(DY, 0.)));
    }

    /** Species are semantic roles; the palette maps them to local assets with engine-safe fallbacks. */
    struct FSpecies { const TCHAR* Role; const TCHAR* Fallback; float MinScale, MaxScale; };
    const FSpecies Canopy[] = {
        {TEXT("Vegetation.Oak.A"), TEXT("/Game/ThirdParty/Quaternius/Nature/CommonTree_1"), .80f, 1.05f},
        {TEXT("Vegetation.Oak.B"), TEXT("/Game/ThirdParty/Quaternius/Nature/CommonTree_1"), .85f, 1.10f},
        {TEXT("Vegetation.Oak.C"), TEXT("/Game/ThirdParty/Quaternius/Nature/CommonTree_1"), .85f, 1.15f},
    };
    const FSpecies Young = {TEXT("Vegetation.Oak.D"), TEXT("/Game/ThirdParty/Quaternius/Nature/CommonTree_1"), .75f, 1.10f};
    const FSpecies Pine[] = {
        {TEXT("Vegetation.Pine.A"), TEXT("/Game/ThirdParty/Quaternius/Nature/PineTree_1"), 1.2f, 1.9f},
        {TEXT("Vegetation.Pine.B"), TEXT("/Game/ThirdParty/Quaternius/Nature/PineTree_1"), 1.2f, 1.9f},
    };
    const FSpecies Shrub[] = {
        {TEXT("Vegetation.Shrub.A"), TEXT("/Game/ThirdParty/Quaternius/Nature/Bush_1"), .55f, .95f},
        {TEXT("Vegetation.Shrub.B"), TEXT("/Game/ThirdParty/Quaternius/Nature/Bush_1"), .45f, .80f},
        {TEXT("Vegetation.Shrub.C"), TEXT("/Game/ThirdParty/Quaternius/Nature/Bush_1"), .70f, 1.10f},
    };
    const FSpecies Orchard[] = {
        {TEXT("Vegetation.Orchard.A"), TEXT("/Game/ThirdParty/Quaternius/Nature/BirchTree_1"), 1.1f, 1.5f},
        {TEXT("Vegetation.Orchard.B"), TEXT("/Game/ThirdParty/Quaternius/Nature/BirchTree_1"), 1.1f, 1.5f},
    };

    /** Barycentric sample of the same triangles the region terrain mesh renders. */
    struct FColumns
    {
        const TArray<TSharedPtr<FJsonValue>>* Rows = nullptr; int32 Side = 0; double Stride = 8;
        const TArray<TSharedPtr<FJsonValue>>& At(int32 IX, int32 IY) const { return (*Rows)[IX * Side + IY]->AsArray(); }
        double Height(double LX, double LY) const
        {
            const int IX = FMath::Clamp(FMath::FloorToInt(LX / Stride), 0, Side - 2), IY = FMath::Clamp(FMath::FloorToInt(LY / Stride), 0, Side - 2);
            const double U = LX / Stride - IX, V = LY / Stride - IY;
            const double A = At(IX, IY)[2]->AsNumber(), B = At(IX + 1, IY)[2]->AsNumber(), C = At(IX, IY + 1)[2]->AsNumber(), D = At(IX + 1, IY + 1)[2]->AsNumber();
            return U + V <= 1 ? A + (B - A) * U + (C - A) * V : D + (C - D) * (1 - U) + (B - D) * (1 - V);
        }
        const TArray<TSharedPtr<FJsonValue>>& Nearest(double LX, double LY) const
        {
            return At(FMath::Clamp(FMath::RoundToInt(LX / Stride), 0, Side - 1), FMath::Clamp(FMath::RoundToInt(LY / Stride), 0, Side - 1));
        }
        /** Largest height difference across the containing cell; steep cells stay open. */
        double Relief(double LX, double LY) const
        {
            const int IX = FMath::Clamp(FMath::FloorToInt(LX / Stride), 0, Side - 2), IY = FMath::Clamp(FMath::FloorToInt(LY / Stride), 0, Side - 2);
            double Lo = 1e9, Hi = -1e9;
            for (int DX = 0; DX < 2; ++DX) for (int DY = 0; DY < 2; ++DY) { const double H = At(IX + DX, IY + DY)[2]->AsNumber(); Lo = FMath::Min(Lo, H); Hi = FMath::Max(Hi, H); }
            return Hi - Lo;
        }
    };

    const FSpecies& Pick(const FSpecies* Table, int32 Count, float Roll) { return Table[FMath::Clamp(FMath::FloorToInt(Roll * Count), 0, Count - 1)]; }
}

void ATVRegionProjection::Decor(const FString& MeshPath, const FTransform& Local, float CullEnd, bool bShadow, const FString& Material)
{
    const FString Key = FString::Printf(TEXT("decor:%s|%s|%d|%d"), *MeshPath, *Material, FMath::RoundToInt(CullEnd), bShadow ? 1 : 0);
    auto* Batch = Batches.FindRef(Key).Get();
    if (!Batch) {
        auto* Mesh = LoadObject<UStaticMesh>(nullptr, *MeshPath); if (!Mesh) return;
        Batch = NewObject<UHierarchicalInstancedStaticMeshComponent>(this);
        Batch->SetupAttachment(RootComponent); Batch->SetStaticMesh(Mesh);
        Batch->SetCollisionEnabled(ECollisionEnabled::NoCollision); Batch->SetCanEverAffectNavigation(false);
        Batch->SetCastShadow(bShadow); Batch->bAffectDistanceFieldLighting = false;
        if (CullEnd > 0) Batch->SetCullDistances(FMath::RoundToInt(CullEnd * .8f), FMath::RoundToInt(CullEnd));
        if (!Material.IsEmpty()) { if (auto* M = LoadObject<UMaterialInterface>(nullptr, *Material)) for (int32 I = 0; I < Mesh->GetStaticMaterials().Num(); ++I) Batch->SetMaterial(I, M); }
        else if (auto* Wrapper = FTVEnvironmentGrammar::WrapperMaterial(MeshPath)) { for (int32 I = 0; I < Mesh->GetStaticMaterials().Num(); ++I) Batch->SetMaterial(I, Wrapper); }
        else for (int32 I = 0; I < Mesh->GetStaticMaterials().Num(); ++I) if (auto* Safe = FTVEnvironmentGrammar::InstancingMaterial(Mesh->GetMaterial(I))) Batch->SetMaterial(I, Safe);
        Batch->ComponentTags.Add(TEXT("TV.Decorative.NoGameplay"));
        Batch->RegisterComponent(); Batches.Add(Key, Batch);
    }
    Batch->AddInstance(Local);
    ++DecorativeCount;
}

void ATVRegionProjection::Woodland(const TSharedPtr<FJsonObject>& R)
{
    const auto T = R->GetObjectField(TEXT("terrain"));
    FColumns Columns; Columns.Rows = &List(T, TEXT("columns")); Columns.Stride = Num(T, TEXT("stride"), 8);
    Columns.Side = FMath::RoundToInt(FMath::Sqrt(static_cast<double>(Columns.Rows->Num())));
    if (Columns.Side < 2) return;
    TArray<FRect> Settlements, Places;
    for (const auto& V : List(R, TEXT("settlements"))) Settlements.Add(Bounds(V->AsObject()->GetObjectField(TEXT("bounds"))));
    for (const auto& V : List(R, R->HasField(TEXT("dressingExclusions")) ? TEXT("dressingExclusions") : TEXT("places"))) Places.Add(Bounds(V->AsObject()->GetObjectField(TEXT("bounds"))));
    TSet<FIntPoint> PathCells;
    for (const auto& V : List(R, TEXT("paths"))) { const auto& C = V->AsArray(); PathCells.Add(FIntPoint(C[0]->AsNumber(), C[2]->AsNumber())); }
    TArray<FTVSurfaceRoute> Routes;
    for (const auto& Road : List(R, TEXT("roads"))) { const auto& Points = List(Road->AsObject(), TEXT("points"));
        for (int32 I = 1; I < Points.Num(); ++I) { const auto A = Points[I - 1]->AsObject(), B = Points[I]->AsObject();
            Routes.Add({FVector2D(Num(A, TEXT("x")), Num(A, TEXT("z"))), FVector2D(Num(B, TEXT("x")), Num(B, TEXT("z"))), 2.f}); } }

    const auto RouteClearance = [&](double X, double Y, int32 Radius) {
        double Best = Radius + 1.;
        const FIntPoint Cell(FMath::FloorToInt(X), FMath::FloorToInt(Y));
        for (int32 DX = -Radius; DX <= Radius; ++DX) for (int32 DY = -Radius; DY <= Radius; ++DY)
            if (PathCells.Contains(Cell + FIntPoint(DX, DY))) Best = FMath::Min(Best, FVector2D::Distance(FVector2D(X, Y), FVector2D(Cell.X + DX + .5, Cell.Y + DY + .5)));
        for (const auto& Route : Routes) Best = FMath::Min(Best, static_cast<double>(FTVEnvironmentGrammar::RouteDistance(FVector2D(X, Y), Route)));
        return Best;
    };
    const auto EdgeDistance = [&](double X, double Y) {
        // Positive outside every settlement; negative depth inside the nearest containing one.
        double Best = 1e6; for (const auto& S : Settlements) Best = FMath::Min(Best, SignedDistance(S, X, Y)); return Best;
    };
    const auto PlaceDistance = [&](double X, double Y) { double Best = 1e6; for (const auto& P : Places) Best = FMath::Min(Best, SignedDistance(P, X, Y)); return Best; };

    const auto Plant = [&](const FSpecies& Species, double LX, double LY, float RollScale, float RollYaw, bool bShadow, float Cull) {
        const FString Mesh = FTVEnvironmentGrammar::Asset(Species.Role, Species.Fallback);
        const float Scale = FMath::Lerp(Species.MinScale, Species.MaxScale, RollScale);
        const double H = Columns.Height(LX, LY);
        Decor(Mesh, FTransform(FRotator(0, RollYaw * 360, 0), FVector(LX * 100, LY * 100, H * 100 - 15), FVector(Scale)), Cull, bShadow);
    };

    // Canopy: six-metre world cells. Density is a canonical-forest gradient shaped by settlement
    // structure: open village core, orchards beside dwellings, a thickening edge, then woods with
    // clearings. Routes, buildings, fields, water and steep cells stay clear.
    const double X0 = CanonicalBase.X, Y0 = CanonicalBase.Y;
    const int32 Grid = 5;
    for (int32 GX = FMath::FloorToInt(X0 / Grid); GX * Grid < X0 + 256; ++GX) for (int32 GY = FMath::FloorToInt(Y0 / Grid); GY * Grid < Y0 + 256; ++GY) {
        const double WX = GX * Grid + Hash01(GX, GY, 11) * Grid, WY = GY * Grid + Hash01(GX, GY, 12) * Grid;
        if (WX < X0 || WX >= X0 + 256 || WY < Y0 || WY >= Y0 + 256) continue;
        const double LX = WX - X0, LY = WY - Y0;
        const auto& C = Columns.Nearest(LX, LY);
        const int32 Block = FMath::RoundToInt(C[3]->AsNumber());
        if (C[4]->AsNumber() >= 0 || (Block != 1 && Block != 2 && Block != 4) || Columns.Relief(LX, LY) > 2.5) continue;
        const double Forest = C[5]->AsNumber();
        const double Edge = EdgeDistance(WX, WY), Place = PlaceDistance(WX, WY);
        const double Clear = RouteClearance(WX, WY, 7);
        if (Clear < 4.5 || Place < 4) continue;
        const float Roll = Hash01(GX, GY, 13);
        double Density;
        bool bOrchard = false;
        if (Edge < 0) {
            // Inside the settlement: mostly open, trees gathering toward its boundary.
            const double TowardEdge = FMath::SmoothStep(-70., -6., Edge);
            Density = Forest * FMath::Lerp(.02, .62, TowardEdge);
            if (Place > 5 && Place < 16 && Clear > 6) { bOrchard = Hash01(GX, GY, 14) < .22f; if (bOrchard) Density = FMath::Max(Density, .30); }
        } else {
            const double Clearing = FMath::SmoothStep(.30, .52, static_cast<double>(FTVEnvironmentGrammar::Cluster(FVector2D(WX, WY) / 3.3, 5)));
            Density = FMath::Min(1., FMath::Pow(Forest, 1.1) * FMath::Lerp(.55, 1.15, FMath::SmoothStep(0., 45., Edge)) * FMath::Lerp(.45, 1., Clearing));
            if (Clear < 9) Density *= .35;
        }
        if (Roll > Density) continue;
        const float Kind = Hash01(GX, GY, 15);
        const bool bNearEdge = FMath::Abs(Edge) < 18 || Clear < 9;
        const bool bShadow = true;
        if (bOrchard) Plant(Pick(Orchard, 2, Kind), LX, LY, Hash01(GX, GY, 16), Hash01(GX, GY, 17), bShadow, 0);
        else if (bNearEdge && Kind < .38f) Plant(Pick(Shrub, 3, Hash01(GX, GY, 18)), LX, LY, Hash01(GX, GY, 16), Hash01(GX, GY, 17), bShadow, 0);
        else if (Kind < .52f) Plant(Young, LX, LY, Hash01(GX, GY, 16), Hash01(GX, GY, 17), bShadow, 0);
        else if (Kind < .58f) Plant(Pick(Pine, 2, Hash01(GX, GY, 18)), LX, LY, Hash01(GX, GY, 16), Hash01(GX, GY, 17), bShadow, 0);
        else Plant(Pick(Canopy, 3, Hash01(GX, GY, 18)), LX, LY, Hash01(GX, GY, 16), Hash01(GX, GY, 17), bShadow, 0);
    }

    // Understory: three-metre cells in the settlement/woodland transition and along field and
    // route margins, so the edge reads as hedge and scrub rather than a line of trunks.
    for (int32 GX = FMath::FloorToInt(X0 / 3); GX * 3 < X0 + 256; ++GX) for (int32 GY = FMath::FloorToInt(Y0 / 3); GY * 3 < Y0 + 256; ++GY) {
        const double WX = GX * 3 + Hash01(GX, GY, 21) * 3, WY = GY * 3 + Hash01(GX, GY, 22) * 3;
        if (WX < X0 || WX >= X0 + 256 || WY < Y0 || WY >= Y0 + 256) continue;
        const double LX = WX - X0, LY = WY - Y0, Edge = EdgeDistance(WX, WY);
        if (FMath::Abs(Edge) > 26) continue;
        const auto& C = Columns.Nearest(LX, LY);
        const int32 Block = FMath::RoundToInt(C[3]->AsNumber());
        if (C[4]->AsNumber() >= 0 || (Block != 1 && Block != 2)) continue;
        const double Place = PlaceDistance(WX, WY), Clear = RouteClearance(WX, WY, 5);
        if (Clear < 3.5 || Place < 2.5) continue;
        const double Band = 1. - FMath::SmoothStep(4., 26., FMath::Abs(Edge - 6.));
        const double FieldMargin = Place < 6 ? .35 : 0.;
        if (Hash01(GX, GY, 23) > C[5]->AsNumber() * (.22 * Band + FieldMargin * .5)) continue;
        Plant(Pick(Shrub, 3, Hash01(GX, GY, 24)), LX, LY, Hash01(GX, GY, 25) * .6f, Hash01(GX, GY, 26), true, 12000);
    }
}

ATVVistaProjection::ATVVistaProjection()
{
    PrimaryActorTick.bCanEverTick = false;
    SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("VistaOrigin")));
    Ground = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("VistaGround"));
    Ground->SetupAttachment(RootComponent); Ground->SetCollisionEnabled(ECollisionEnabled::NoCollision); Ground->SetCastShadow(false);
    Tags.Add(TEXT("TV.Decorative.Vista"));
}

void ATVVistaProjection::Build(const TSharedPtr<FJsonObject>& V)
{
    const double Start = FPlatformTime::Seconds();
    for (auto& Pair : Trees) if (Pair.Value) Pair.Value->DestroyComponent();
    Trees.Empty(); TreeCount = 0;
    Center = V->GetStringField(TEXT("center"));
    const auto O = V->GetObjectField(TEXT("origin"));
    const double OX = Num(O, TEXT("x")), OZ = Num(O, TEXT("z")), Stride = Num(V, TEXT("stride"), 32);
    const int32 Side = Num(V, TEXT("side"));
    const FString Heights = V->GetStringField(TEXT("heights")), Forest = V->GetStringField(TEXT("forest")), Surface = V->GetStringField(TEXT("surface"));
    if (Side < 2 || Heights.Len() != Side * Side || Forest.Len() != Side * Side || Surface.Len() != Side * Side) return;
    CanonicalBase = FVector(OX, OZ, 0);
    int32 RX = 0, RZ = 0; { FString A, B; Center.Split(TEXT(","), &A, &B); RX = FCString::Atoi(*A); RZ = FCString::Atoi(*B); }
    // The nine streamed regions own their ground. The horizon tucks 16 m underneath their edge.
    const double InX0 = (RX - 1) * 256. + 16, InX1 = (RX + 2) * 256. - 16, InZ0 = (RZ - 1) * 256. + 16, InZ1 = (RZ + 2) * 256. - 16;
    TArray<FRect> Settlements;
    for (const auto& S : List(V, TEXT("settlements"))) Settlements.Add(Bounds(S->AsObject()->GetObjectField(TEXT("bounds"))));
    const auto H = [&](int32 I, int32 J) { return static_cast<double>(Heights[I * Side + J] - 48); };

    TArray<FVector> Vertices, Normals; TArray<int32> Triangles; TArray<FVector2D> UV; TArray<FLinearColor> Colors; TArray<FProcMeshTangent> Tangents;
    for (int32 I = 0; I < Side; ++I) for (int32 J = 0; J < Side; ++J) {
        Vertices.Add(FVector(I * Stride * 100, J * Stride * 100, H(I, J) * 100 - 45));
        UV.Add(FVector2D(I * Stride + FMath::Fmod(OX, 4.), J * Stride + FMath::Fmod(OZ, 4.)) / 4.);
        const TCHAR Kind = Surface[I * Side + J];
        Colors.Add(FLinearColor(Kind == 'p' ? .9f : Kind == 's' || Kind == 'r' ? .6f : 0, 0, (Forest[I * Side + J] - 48) / 9.f, 0));
    }
    for (int32 I = 0; I + 1 < Side; ++I) for (int32 J = 0; J + 1 < Side; ++J) {
        const double CX0 = OX + I * Stride, CZ0 = OZ + J * Stride;
        if (CX0 >= InX0 && CX0 + Stride <= InX1 && CZ0 >= InZ0 && CZ0 + Stride <= InZ1) continue;
        const int32 A = I * Side + J, Next = A + Side;
        Triangles.Append({A, A + 1, Next, A + 1, Next + 1, Next});
    }
    Normals.SetNumZeroed(Vertices.Num());
    for (int32 I = 0; I + 2 < Triangles.Num(); I += 3) {
        FVector Face = FVector::CrossProduct(Vertices[Triangles[I + 1]] - Vertices[Triangles[I]], Vertices[Triangles[I + 2]] - Vertices[Triangles[I]]);
        if (Face.Z < 0) Face *= -1;
        for (int32 K = 0; K < 3; ++K) Normals[Triangles[I + K]] += Face;
    }
    for (FVector& N : Normals) N = N.IsNearlyZero() ? FVector::UpVector : N.GetSafeNormal();
    Ground->ClearAllMeshSections();
    Ground->CreateMeshSection_LinearColor(0, Vertices, Triangles, Normals, UV, Colors, Tangents, false);
    if (auto* M = LoadObject<UMaterialInterface>(nullptr, *FTVEnvironmentGrammar::Asset(TEXT("Ground.Settlement"), TEXT("/Game/TornVeil/Materials/M_TV_PH_Soil")))) Ground->SetMaterial(0, M);

    // Woodland beyond the streamed regions, within 2.2 km: forest-weighted trees per 32 m cell.
    const auto Batch = [&](const FString& Mesh, bool bShadow) {
        const FString Key = Mesh + (bShadow ? TEXT("|s") : TEXT("|n"));
        if (auto* Found = Trees.FindRef(Key).Get()) return Found;
        auto* StaticMesh = LoadObject<UStaticMesh>(nullptr, *Mesh); if (!StaticMesh) return static_cast<UHierarchicalInstancedStaticMeshComponent*>(nullptr);
        auto* New = NewObject<UHierarchicalInstancedStaticMeshComponent>(this);
        New->SetupAttachment(RootComponent); New->SetStaticMesh(StaticMesh); New->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        New->SetCanEverAffectNavigation(false); New->SetCastShadow(bShadow); New->bAffectDistanceFieldLighting = false;
        New->ComponentTags.Add(TEXT("TV.Decorative.NoGameplay")); New->RegisterComponent(); Trees.Add(Key, New);
        return New;
    };
    const double CX = (RX + .5) * 256, CZ = (RZ + .5) * 256;
    for (int32 I = 0; I + 1 < Side; ++I) for (int32 J = 0; J + 1 < Side; ++J) {
        const double CX0 = OX + I * Stride, CZ0 = OZ + J * Stride;
        const double Distance = FVector2D::Distance(FVector2D(CX0 + Stride / 2, CZ0 + Stride / 2), FVector2D(CX, CZ));
        if (Distance > 2700 || (CX0 + Stride > InX0 - 16 && CX0 < InX1 + 16 && CZ0 + Stride > InZ0 - 16 && CZ0 < InZ1 + 16)) continue;
        const TCHAR Kind = Surface[I * Side + J];
        if (Kind != 'g') continue;
        const double F = (Forest[I * Side + J] - 48) / 9.;
        const int32 GX = FMath::FloorToInt(CX0 / Stride), GY = FMath::FloorToInt(CZ0 / Stride);
        const int32 Count = FMath::FloorToInt(FMath::Pow(F, 1.2) * (Distance < 1400 ? 5.2 : 3.6) + Hash01(GX, GY, 31));
        for (int32 K = 0; K < Count; ++K) {
            const double U = Hash01(GX, GY, 40 + K), W = Hash01(GX, GY, 60 + K);
            const double WX = CX0 + U * Stride, WZ = CZ0 + W * Stride;
            bool bInside = false; for (const auto& S : Settlements) if (SignedDistance(S, WX, WZ) < 12) { bInside = true; break; }
            if (bInside) continue;
            const double Height = H(I, J) * (1 - U) * (1 - W) + H(I + 1, J) * U * (1 - W) + H(I, J + 1) * (1 - U) * W + H(I + 1, J + 1) * U * W;
            const float Roll = Hash01(GX, GY, 80 + K);
            const FSpecies& Species = Roll < .12f ? Young : Roll < .18f ? Pine[K % 2] : Canopy[FMath::FloorToInt(Hash01(GX, GY, 90 + K) * 3) % 3];
            const FString Mesh = FTVEnvironmentGrammar::Asset(Species.Role, Species.Fallback);
            if (auto* Target = Batch(Mesh, Distance < 900)) {
                const float Scale = FMath::Lerp(Species.MinScale, Species.MaxScale, Hash01(GX, GY, 100 + K));
                Target->AddInstance(FTransform(FRotator(0, Hash01(GX, GY, 110 + K) * 360, 0), FVector((WX - OX) * 100, (WZ - OZ) * 100, Height * 100 - 60), FVector(Scale)));
                ++TreeCount;
            }
        }
    }
    BuildMilliseconds = (FPlatformTime::Seconds() - Start) * 1000;
    UE_LOG(LogTemp, Display, TEXT("TV_VISTA %s build_ms=%.2f trees=%d"), *Center, BuildMilliseconds, TreeCount);
}
