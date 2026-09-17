#include "TVEnvironmentGrammar.h"
#include "Dom/JsonObject.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/PackageName.h"
#include "Serialization/JsonSerializer.h"
#include "Materials/MaterialInterface.h"

namespace { TSharedPtr<FJsonObject> EnvironmentPalette; TMap<FString,FString> ResolvedAssets; }

TArray<FTVRoofPanel> FTVEnvironmentGrammar::Roof(const FVector& Base, const FVector2D& Footprint, float WallHeight) {
    TArray<FTVRoofPanel> Result;
    if (Footprint.X <= 0 || Footprint.Y <= 0 || WallHeight <= 0) return Result;
    // The audited wooden panel is one roof slope, not a complete roof. Its local Y minimum
    // is the ridge. Pair opposite slopes; the ridge follows the footprint's long axis.
    const bool AlongX = Footprint.X >= Footprint.Y;
    const float Length = AlongX ? Footprint.X : Footprint.Y;
    const float Width = AlongX ? Footprint.Y : Footprint.X;
    const float Eave = 25.f, Run = Width / 2 + Eave, Rise = Run * .65f;
    const int32 Bays = FMath::Max(1, FMath::CeilToInt((Length + 2 * Eave) / 220.f));
    const float Bay = (Length + 2 * Eave) / Bays;
    for (int32 I = 0; I < Bays; ++I) for (int32 Sign : {-1, 1}) {
        const float Along = -Eave + (I + .5f) * Bay;
        const float Across = Width / 2 + Sign * Run / 2;
        const FVector Center = Base + (AlongX ? FVector(Along, Across, WallHeight + Rise / 2 - 3)
                                                            : FVector(Across, Along, WallHeight + Rise / 2 - 3));
        Result.Add({Center, FVector(Bay + 2, Run, Rise), AlongX ? (Sign > 0 ? 0.f : 180.f) : (Sign > 0 ? 270.f : 90.f)});
    }
    return Result;
}

float FTVEnvironmentGrammar::RouteDistance(const FVector2D& P, const FTVSurfaceRoute& R) {
    const FVector2D D = R.B - R.A;
    const double T = D.SizeSquared() > UE_SMALL_NUMBER ? FMath::Clamp(FVector2D::DotProduct(P - R.A, D) / D.SizeSquared(), 0., 1.) : 0.;
    return FVector2D::Distance(P, R.A + D * T);
}

float FTVEnvironmentGrammar::WornGround(const FVector2D& P, const TSet<FIntPoint>& Paths, const TArray<FTVSurfaceRoute>& Routes) {
    float Mask = 0;
    const FIntPoint Cell(FMath::FloorToInt(P.X), FMath::FloorToInt(P.Y));
    // Union the existing one-metre route cells before feathering: no disconnected tiles,
    // invented shortcuts, per-cell height offsets or raised collision-free kerbs.
    for (int32 X = -2; X <= 2; ++X) for (int32 Y = -2; Y <= 2; ++Y) {
        const FIntPoint Q = Cell + FIntPoint(X, Y);
        if (!Paths.Contains(Q)) continue;
        const double DX = FMath::Max(FMath::Abs(P.X - Q.X - .5) - .5, 0.);
        const double DY = FMath::Max(FMath::Abs(P.Y - Q.Y - .5) - .5, 0.);
        Mask = FMath::Max(Mask, 1.f - FMath::SmoothStep(0.f, 1.2f, static_cast<float>(FMath::Sqrt(DX * DX + DY * DY))));
    }
    for (const auto& R : Routes) Mask = FMath::Max(Mask, 1.f - FMath::SmoothStep(R.HalfWidth - .4f, R.HalfWidth + .8f, RouteDistance(P, R)));
    return Mask;
}

float FTVEnvironmentGrammar::Cluster(const FVector2D& P, int32 Seed) {
    // Continuous, world-anchored density; region load order cannot move a cluster.
    const FVector2D Offset((Seed & 255) * 3.17, ((Seed >> 8) & 255) * 2.71);
    return FMath::Clamp(.5f + .5f * FMath::PerlinNoise2D(P / 19. + Offset), 0.f, 1.f);
}

void FTVEnvironmentGrammar::ReloadPalette() {
    EnvironmentPalette.Reset(); ResolvedAssets.Empty(); FString Text;
    if (FFileHelper::LoadFileToString(Text, *(FPaths::ProjectContentDir() / TEXT("TornVeil/Presentation/EnvironmentPalette.json"))))
        FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), EnvironmentPalette);
    if (!EnvironmentPalette) UE_LOG(LogTemp, Warning, TEXT("EnvironmentPalette missing; using documented local defaults"));
}
FString FTVEnvironmentGrammar::Asset(const TCHAR* Role, const TCHAR* Fallback) {
    const FString Key=FString(Role)+TEXT("|")+Fallback;
    if(const FString* Cached=ResolvedAssets.Find(Key)) return *Cached;
    FString Path;
    if(EnvironmentPalette && EnvironmentPalette->TryGetStringField(Role,Path) && Path.StartsWith(TEXT("/Game/"))) {
        // Local licensed packs are optional prerequisites. A missing package must never
        // silently remove a roof or fixture on a checkout that only has the base palette.
        if(FPackageName::DoesPackageExist(FPackageName::ObjectPathToPackageName(Path))) { ResolvedAssets.Add(Key,Path); return Path; }
        UE_LOG(LogTemp,Warning,TEXT("Palette role %s unavailable (%s); using fallback"),Role,*Path);
    }
    ResolvedAssets.Add(Key,Fallback); return FString(Fallback);
}

UMaterialInterface* FTVEnvironmentGrammar::InstancingMaterial(const UMaterialInterface* Source) {
    // AdvancedVillage base materials were authored without the InstancedStaticMeshes usage flag.
    // create_local_village_materials.py derives flagged copies; unknown sources keep their material.
    static TMap<FString,TWeakObjectPtr<UMaterialInterface>> Cache;
    if(!Source) return nullptr;
    const FString Path=Source->GetPathName();
    static const FString Prefix=TEXT("/Game/AdvancedVillagePack/Materials/M_Inst_");
    if(!Path.StartsWith(Prefix)) return nullptr;
    if(const auto* Found=Cache.Find(Path)) return Found->Get();
    const FString Name=Path.Mid(Prefix.Len()).Left(Path.Mid(Prefix.Len()).Find(TEXT(".")));
    const FString Local=FString::Printf(TEXT("/Game/TornVeil/Materials/LocalPalette/Village/M_TV_Village_%s.M_TV_Village_%s"),*Name,*Name);
    UMaterialInterface* Copy=FPackageName::DoesPackageExist(FPackageName::ObjectPathToPackageName(Local))?LoadObject<UMaterialInterface>(nullptr,*Local):nullptr;
    Cache.Add(Path,Copy);
    return Copy;
}

UMaterialInterface* FTVEnvironmentGrammar::WrapperMaterial(const FString& MeshPath) {
    // Free Medieval props ship materials pointing at default textures; local PBR wrappers bind the
    // pack's own texture sets (create_local_prop_materials.py). Missing wrappers keep the source.
    static const FString Marker=TEXT("/Medieval1_fbx_");
    const int32 At=MeshPath.Find(Marker); if(At==INDEX_NONE) return nullptr;
    FString Name=MeshPath.Mid(At+Marker.Len()); Name=Name.Left(Name.Find(TEXT(".")) == INDEX_NONE ? Name.Len() : Name.Find(TEXT(".")));
    const FString Local=FString::Printf(TEXT("/Game/TornVeil/Materials/LocalPalette/M_TV_Local_%s.M_TV_Local_%s"),*Name,*Name);
    return FPackageName::DoesPackageExist(FPackageName::ObjectPathToPackageName(Local))?LoadObject<UMaterialInterface>(nullptr,*Local):nullptr;
}
