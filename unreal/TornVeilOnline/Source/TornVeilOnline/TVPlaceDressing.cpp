// Functional environmental storytelling. Every cluster is derived from a canonical place's type,
// footprint, door and the surrounding path cells, so a workplace reads as what the simulation
// says happens there. Props are decorative and non-colliding: they hug walls and place edges and
// keep clear of path cells and door approaches, where canonical people actually walk.
#include "TVWorldProjection.h"
#include "TVEnvironmentGrammar.h"
#include "Components/PointLightComponent.h"
#include "Engine/StaticMesh.h"
#include "Dom/JsonObject.h"

namespace
{
    double Num(const TSharedPtr<FJsonObject>& P, const TCHAR* Key, double Default = 0) { double V; return P->TryGetNumberField(Key, V) ? V : Default; }
    FString Str(const TSharedPtr<FJsonObject>& P, const TCHAR* Key) { FString V; P->TryGetStringField(Key, V); return V; }
    const TArray<TSharedPtr<FJsonValue>>& List(const TSharedPtr<FJsonObject>& P, const TCHAR* Key) { static TArray<TSharedPtr<FJsonValue>> Empty; const TArray<TSharedPtr<FJsonValue>>* A; return P->TryGetArrayField(Key, A) ? *A : Empty; }

    const TCHAR* Village = TEXT("/Game/AdvancedVillagePack/Meshes/");
    const TCHAR* Medieval = TEXT("/Game/Fab/Free_Medieval_Environment_Props_Collection/Medieval1_fbx_");
    FString V(const TCHAR* Name) { return FString(Village) + Name; }
    FString M(const TCHAR* Name) { return FString(Medieval) + Name; }

    /** A place rectangle in metres with its canonical door side (0:-Z 1:+Z 2:-X 3:+X, -1 none). */
    struct FPlace
    {
        FString Type, Family; double X0, Y0, X1, Y1, Floor; int32 DoorSide = -1; FVector2D Door = FVector2D(-1e9); bool bIndoor = false; int32 Seed = 0;
        FVector2D Inside = FVector2D(-1e9);
        double Length(int32 Side) const { return Side < 2 ? X1 - X0 : Y1 - Y0; }
        /** Point `Along` metres down a side, `Out` metres beyond the wall face. */
        FVector2D OnSide(int32 Side, double Along, double Out) const
        {
            switch (Side) {
            case 0: return FVector2D(X0 + Along, Y0 - Out);
            case 1: return FVector2D(X0 + Along, Y1 + Out);
            case 2: return FVector2D(X0 - Out, Y0 + Along);
            default: return FVector2D(X1 + Out, Y0 + Along);
            }
        }
        float WallYaw(int32 Side) const { return Side < 2 ? 0.f : 90.f; }
        int32 Opposite(int32 Side) const { return Side ^ 1; }
    };
}

void ATVRegionProjection::Prop(const TCHAR* AssetRole, const TCHAR* Fallback, const FVector& C, float Yaw, float Height, float CullEnd)
{
    const FString MeshPath = FTVEnvironmentGrammar::Asset(AssetRole, Fallback);
    const auto* Mesh = LoadObject<UStaticMesh>(nullptr, *MeshPath); if (!Mesh) return;
    const FBox Box = Mesh->GetBoundingBox();
    const float Scale = Height / FMath::Max(Box.GetSize().Z, 1.);
    const FQuat Rotation = FRotator(0, Yaw, 0).Quaternion();
    const FVector Pivot = FVector(Box.GetCenter().X, Box.GetCenter().Y, Box.Min.Z) * Scale;
    Decor(MeshPath, FTransform(Rotation, C - CanonicalBase * 100 - Rotation.RotateVector(Pivot), FVector(Scale)), CullEnd, true, TEXT(""));
}

void ATVRegionProjection::Lamp(const FVector& C, float Candela, float Radius, const FLinearColor& Color)
{
    auto* Light = NewObject<UPointLightComponent>(this);
    Light->SetupAttachment(RootComponent);
    Light->SetMobility(EComponentMobility::Movable);
    Light->SetRelativeLocation(C - CanonicalBase * 100);
    Light->SetIntensityUnits(ELightUnits::Candelas);
    Light->SetIntensity(Candela);
    Light->SetLightColor(Color);
    Light->SetAttenuationRadius(Radius);
    Light->SetSourceRadius(8);
    Light->SetCastShadows(false);
    Light->ComponentTags.Add(TEXT("TV.Decorative.NoGameplay"));
    Light->RegisterComponent();
    Lamps.Add(Light);
}

void ATVRegionProjection::DressPlaces(const TSharedPtr<FJsonObject>& R)
{
    TSet<FIntPoint> PathCells;
    for (const auto& Cell : List(R, TEXT("paths"))) { const auto& C = Cell->AsArray(); PathCells.Add(FIntPoint(C[0]->AsNumber(), C[2]->AsNumber())); }
    for (const auto& Cell : List(R, TEXT("fences"))) { const auto& C = Cell->AsArray(); PathCells.Add(FIntPoint(C[0]->AsNumber(), C[2]->AsNumber())); }
    TArray<FPlace> Places;
    for (const auto& Value : List(R, TEXT("places"))) {
        const auto P = Value->AsObject(); const auto B = P->GetObjectField(TEXT("bounds"));
        FPlace Place{Str(P, TEXT("type")), Str(P, TEXT("family")), Num(B, TEXT("x0")), Num(B, TEXT("z0")), Num(B, TEXT("x1")) + 1, Num(B, TEXT("z1")) + 1, Num(B, TEXT("y0"))};
        P->TryGetBoolField(TEXT("indoor"), Place.bIndoor);
        Place.Seed = static_cast<int32>(Num(P, TEXT("visualSeed")));
        const TSharedPtr<FJsonObject>* Inside;
        if (P->TryGetObjectField(TEXT("inside"), Inside)) Place.Inside = FVector2D(Num(*Inside,TEXT("x")),Num(*Inside,TEXT("z")));
        const TSharedPtr<FJsonObject>* Door;
        if (P->TryGetObjectField(TEXT("door"), Door)) {
            const double DX = Num(*Door, TEXT("x")), DZ = Num(*Door, TEXT("z"));
            Place.Door = FVector2D(DX + .5, DZ + .5);
            Place.DoorSide = DZ < Place.Y0 ? 0 : DZ >= Place.Y1 ? 1 : DX < Place.X0 ? 2 : DX >= Place.X1 ? 3 : -1;
        }
        Places.Add(Place);
    }
    const auto Clear = [&](const FVector2D& P, const FPlace& Host, double Radius) {
        // Path cells have area, and the canonical inside point is used for arrival and
        // ordinary activities. Decorative meshes cannot occupy those clear spaces.
        const double PathRadius=Radius+.71;
        const FIntPoint Cell(FMath::FloorToInt(P.X), FMath::FloorToInt(P.Y)); const int32 Reach = FMath::CeilToInt(PathRadius);
        for (int32 DX = -Reach; DX <= Reach; ++DX) for (int32 DY = -Reach; DY <= Reach; ++DY)
            if (PathCells.Contains(Cell + FIntPoint(DX, DY)) && FVector2D::Distance(P, FVector2D(Cell.X + DX + .5, Cell.Y + DY + .5)) < PathRadius) return false;
        if (FVector2D::Distance(P, Host.Door) < Radius+1.5) return false;
        if (FVector2D::Distance(P, Host.Inside) < Radius+(Host.Type==TEXT("square")?3.2:1.5)) return false;
        for (const auto& Other : Places) if (&Other != &Host && P.X > Other.X0 - .5 && P.X < Other.X1 + .5 && P.Y > Other.Y0 - .5 && P.Y < Other.Y1 + .5) return false;
        return true;
    };

    for (const FPlace& Place : Places) {
        FRandomStream Random(Place.Seed ^ 0x5eed);
        const double Z = Place.Floor * 100;
        const auto Put = [&](const FVector2D& P, const TCHAR* AssetRole, const FString& Fallback, float Yaw, float Height, double Radius = 1.1, float Cull = 0) {
            // Match Prop's uniform height scaling. A table/cart's long footprint must
            // clear the route too; a guessed radius around its pivot is insufficient.
            const auto* Mesh=LoadObject<UStaticMesh>(nullptr,*FTVEnvironmentGrammar::Asset(AssetRole,*Fallback));
            if(!Mesh) return false;
            const FVector Size=Mesh->GetBoundingBox().GetSize();
            const double Footprint=Size.Size2D()*.5*Height/FMath::Max(Size.Z,1.)/100.;
            if (!Clear(P, Place, FMath::Max(Radius,Footprint+.4))) return false;
            Prop(AssetRole, *Fallback, FVector(P.X * 100, P.Y * 100, Z), Yaw, Height, Cull);
            return true;
        };
        const int32 Front = Place.DoorSide >= 0 ? Place.DoorSide : 0, Back = Place.Opposite(Front);
        const int32 Left = Front < 2 ? 2 : 0, Right = Left ^ 1;
        const double DoorAlong = Front < 2 ? Place.Door.X - Place.X0 : Place.Door.Y - Place.Y0;
        const auto Flowers = [&](int32 Side, double Out) {
            for (double T = .6; T < Place.Length(Side) - .6; T += .55 + Random.FRand() * .5)
                if (FMath::Abs(T - DoorAlong) > 1.4 || Side != Front)
                    Put(Place.OnSide(Side, T, Out + Random.FRand() * .25), TEXT("Prop.Flowers"), V(*FString::Printf(TEXT("SM_Flower_Var0%d"), 1 + Random.RandRange(0, 5))), Random.FRand() * 360, 35 + Random.FRand() * 20, .7, 5000);
        };
        const auto WallLantern = [&](double Along) {
            const FVector2D P = Place.OnSide(Front, Along, .12);
            Prop(TEXT("Prop.WallLantern"), *M(TEXT("WallLantern")), FVector(P.X * 100, P.Y * 100, Z + 205), Place.WallYaw(Front) + (Front == 0 || Front == 2 ? 180 : 0), 42);
            Lamp(FVector(P.X * 100, P.Y * 100, Z + 225), 60, 500);
        };

        if (Place.bIndoor && Place.Family == TEXT("dwelling")) {
            // Household: firewood and a chopping block behind, water butt and a seat by the door,
            // a kitchen garden to one side, flowers under the front windows.
            Put(Place.OnSide(Back, Place.Length(Back) * .35, .75), TEXT("Prop.Firewood"), M(TEXT("LogsPile")), Place.WallYaw(Back), 105);
            Put(Place.OnSide(Back, Place.Length(Back) * .68, 2.1), TEXT("Prop.ChoppingBlock"), V(TEXT("SM_Treestump_Var01")), Random.FRand() * 360, 55);
            Put(Place.OnSide(Front, DoorAlong + 2.3, .6), TEXT("Prop.WaterButt"), M(TEXT("Barrle1")), Random.FRand() * 360, 95);
            Put(Place.OnSide(Front, DoorAlong - 3.1, 1.0), TEXT("Prop.Bench"), M(TEXT("WoodenTableBench")), Place.WallYaw(Front), 80);
            for (int32 I = 0; I < 6; ++I)
                Put(Place.OnSide(Left, 2.2 + (I % 3) * 1.3, 2.4 + (I / 3) * 1.3), TEXT("Prop.GardenCrop"), V(*FString::Printf(TEXT("SM_Pumpkin_Var0%d"), 1 + I % 3)), Random.FRand() * 360, 30 + Random.FRand() * 15, .9);
            Put(Place.OnSide(Left, .9, .6), TEXT("Prop.Sack"), V(TEXT("SM_Sack_Var01")), Random.FRand() * 360, 70);
            Flowers(Front, .45);
            WallLantern(DoorAlong + 1.0);
        } else if (Place.Type == TEXT("tavern")) {
            // Outdoor drinking: table-and-bench sets either side of the door, a keg rack, lanterns.
            Put(Place.OnSide(Front, DoorAlong - 3.6, 2.2), TEXT("Prop.TableBench"), M(TEXT("WoodenTableBench")), Place.WallYaw(Front), 80, 1.4);
            Put(Place.OnSide(Front, DoorAlong + 3.6, 2.2), TEXT("Prop.TableBench"), M(TEXT("WoodenTableBench")), Place.WallYaw(Front), 80, 1.4);
            Put(Place.OnSide(Front, DoorAlong + 6.0, .7), TEXT("Prop.KegRack"), M(TEXT("BarrleStand")), Place.WallYaw(Front), 95);
            for (int32 I = 0; I < 3; ++I) Put(Place.OnSide(Right, 1.2 + I * .95, .6), TEXT("Prop.Barrel"), M(TEXT("Barrle1")), Random.FRand() * 360, 95, .6);
            Put(Place.OnSide(Right, 4.6, .7), TEXT("Prop.Crate"), V(TEXT("SM_Crate_Closed")), Random.FRand() * 30, 70, .6);
            Put(Place.OnSide(Back, Place.Length(Back) * .5, .8), TEXT("Prop.Firewood"), M(TEXT("LogsPile")), Place.WallYaw(Back), 120);
            WallLantern(DoorAlong - 1.1); WallLantern(DoorAlong + 1.1);
        } else if (Place.Type == TEXT("bakery")) {
            // Flour in, bread out: sacks by the door, a large woodstack feeding the oven.
            for (int32 I = 0; I < 4; ++I) Put(Place.OnSide(Front, DoorAlong + 2.2 + I * .6, .55 + (I % 2) * .4), TEXT("Prop.FlourSack"), V(TEXT("SM_Sack_Flour")), Random.FRand() * 360, 60, .6);
            Put(Place.OnSide(Right, Place.Length(Right) * .3, .8), TEXT("Prop.Firewood"), M(TEXT("LogsPile")), Place.WallYaw(Right), 130);
            Put(Place.OnSide(Right, Place.Length(Right) * .62, .8), TEXT("Prop.Firewood"), M(TEXT("LogsPile")), Place.WallYaw(Right), 115);
            Put(Place.OnSide(Right, Place.Length(Right) * .85, 1.4), TEXT("Prop.Logs"), V(TEXT("SM_Logs_Var01")), Place.WallYaw(Right), 70);
            Put(Place.OnSide(Back, 1.3, .6), TEXT("Prop.WaterButt"), M(TEXT("Barrle1")), 0, 95);
            Put(Place.OnSide(Back, 2.3, .5), TEXT("Prop.Bucket"), M(TEXT("Bucket")), 0, 38);
            WallLantern(DoorAlong + 1.0);
        } else if (Place.Type == TEXT("chapel")) {
            Flowers(Front, .45); Flowers(Left, .45); Flowers(Right, .45);
            Put(Place.OnSide(Front, DoorAlong - 3.2, 2.0), TEXT("Prop.StreetLight"), V(TEXT("SM_StreetLight")), 0, 330, .8);
            Put(Place.OnSide(Front, DoorAlong + 3.2, 2.0), TEXT("Prop.StreetLight"), V(TEXT("SM_StreetLight")), 0, 330, .8);
        } else if (Place.Type == TEXT("mill")) {
            // Grain arrives by cart and leaves in sacks.
            Put(Place.OnSide(Front, DoorAlong + 4.2, 3.0), TEXT("Prop.Cart"), V(TEXT("SM_Cart_Var01")), Place.WallYaw(Front) + 15, 170, 1.8);
            for (int32 I = 0; I < 5; ++I) Put(Place.OnSide(Front, DoorAlong - 2.2 - I * .55, .55 + (I % 2) * .45), TEXT("Prop.FlourSack"), V(TEXT("SM_Sack_Flour")), Random.FRand() * 360, 60, .6);
            Put(Place.OnSide(Left, 1.4, .8), TEXT("Prop.Crate"), V(TEXT("SM_Crate_Closed")), 10, 75, .6);
            Put(Place.OnSide(Left, 2.4, .8), TEXT("Prop.Crate"), V(TEXT("SM_Crate_Open")), -8, 65, .6);
        } else if (Place.Type == TEXT("square")) {
            // The shared centre: lamp posts, a notice post, benches and a parked cart on its edges.
            const double CX = (Place.X0 + Place.X1) / 2, CY = (Place.Y0 + Place.Y1) / 2;
            const FVector2D Corners[] = {{Place.X0 + .8, Place.Y0 + .8}, {Place.X1 - .8, Place.Y0 + .8}, {Place.X0 + .8, Place.Y1 - .8}, {Place.X1 - .8, Place.Y1 - .8}};
            int32 Posts = 0;
            for (const auto& Corner : Corners) if (Posts < 2 && Put(Corner, TEXT("Prop.StreetLight"), V(TEXT("SM_StreetLight")), 0, 340, .9)) ++Posts;
            Put(FVector2D(Place.X0 + 1.2, CY + 2.5), TEXT("Prop.NoticePost"), M(TEXT("ArrowSignLR")), 90, 230, .9);
            for (int32 Side = 0; Side < 4; ++Side) {
                const FVector2D Mid = Place.OnSide(Side, Place.Length(Side) * (.3 + .4 * Random.FRand()), -1.2);
                Put(Mid, TEXT("Prop.TableBench"), M(TEXT("WoodenTableBench")), Place.WallYaw(Side), 80, 1.3);
            }
            Put(FVector2D(Place.X1 - 2.2, Place.Y1 - 3.8), TEXT("Prop.Cart"), V(TEXT("SM_Cart_Var02")), 35, 165, 1.6);
            Put(FVector2D(CX + 4.5, Place.Y0 + 1.2), TEXT("Prop.Barrel"), M(TEXT("Barrle1")), 0, 95, .7);
            Put(FVector2D(CX + 5.3, Place.Y0 + 1.4), TEXT("Prop.Barrel"), M(TEXT("Barrle2")), 0, 90, .7);
        } else if (Place.Type == TEXT("well")) {
            const double CX = (Place.X0 + Place.X1) / 2, CY = (Place.Y0 + Place.Y1) / 2;
            Put(FVector2D(CX + 2.3, CY + .4), TEXT("Prop.Bucket"), M(TEXT("Bucket")), 20, 38, .5);
            Put(FVector2D(CX - .6, CY + 2.4), TEXT("Prop.Bucket"), M(TEXT("Bucket")), 70, 38, .5);
            Put(FVector2D(CX + 2.9, CY - 2.2), TEXT("Prop.Trough"), M(TEXT("HalfBarrle")), 45, 55, .8);
        } else if (Place.Type == TEXT("stall")) {
            // Goods on display under the booth roof: produce sacks, open crates, pumpkins and pots.
            const TCHAR* Goods[] = {TEXT("SM_SackWithApples"), TEXT("SM_SackWithTomatoes"), TEXT("SM_SackWithPotatoes"), TEXT("SM_Crate_Open"), TEXT("SM_Pumpkin_Var02"), TEXT("SM_Pot_Var03")};
            int32 Shown = 0;
            for (int32 Side = 0; Side < 4; ++Side) for (double T = 1.0; T < Place.Length(Side) - .8; T += 1.1) {
                const TCHAR* Good = Goods[Shown % 6];
                if (Put(Place.OnSide(Side, T, -.8), TEXT("Prop.MarketGoods"), V(Good), Random.FRand() * 360, FString(Good).Contains(TEXT("Pot")) ? 45 : FString(Good).Contains(TEXT("Pumpkin")) ? 38 : 65, .9)) ++Shown;
            }
            Put(Place.OnSide(Back, Place.Length(Back) * .5, 1.2), TEXT("Prop.Cart"), V(TEXT("SM_Cart_Var02")), Place.WallYaw(Back), 160, 1.4);
        } else if (Place.Type == TEXT("sawpit")) {
            // Timber in, boards out: log stacks, loose logs, a stump with an axe.
            Put(Place.OnSide(0, Place.Length(0) * .3, 1.4), TEXT("Prop.Logs"), V(TEXT("SM_Logs_Var01")), 0, 90, 1.2);
            Put(Place.OnSide(0, Place.Length(0) * .75, 1.4), TEXT("Prop.Logs"), V(TEXT("SM_Logs_Var02")), 0, 80, 1.2);
            for (int32 I = 0; I < 3; ++I) Put(Place.OnSide(1, 1.5 + I * 1.1, 1.0), TEXT("Prop.LogLong"), M(TEXT("LogLong")), 0, 40, .8);
            Put(Place.OnSide(2, Place.Length(2) * .5, 1.3), TEXT("Prop.ChoppingBlock"), V(TEXT("SM_Treestump_Var02")), 0, 55, .8);
            Put(Place.OnSide(2, Place.Length(2) * .5 + .5, 1.6), TEXT("Prop.Axe"), V(TEXT("SM_Axe")), 30, 75, .8);
        } else if (Place.Type == TEXT("quarry")) {
            // Worked stone: boulders at the face, dressed blocks stacked for hauling, a stone cart.
            for (int32 I = 0; I < 7; ++I) {
                const int32 Side = I % 4; const double T = Place.Length(Side) * (.15 + .7 * Random.FRand());
                Put(Place.OnSide(Side, T, -1.4 - Random.FRand()), TEXT("Prop.Boulder"), V(*FString::Printf(TEXT("SM_Stone_Big_Var0%d"), 1 + I % 5)), Random.FRand() * 360, 110 + Random.FRand() * 90, 1.4);
            }
            for (int32 I = 0; I < 9; ++I)
                Put(FVector2D(Place.X0 + 2 + Random.FRand() * (Place.X1 - Place.X0 - 4), Place.Y0 + 2 + Random.FRand() * (Place.Y1 - Place.Y0 - 4)), TEXT("Prop.Stone"), V(*FString::Printf(TEXT("SM_Stone_Medium_Var0%d"), 1 + I % 5)), Random.FRand() * 360, 35 + Random.FRand() * 30, 1.0);
            for (int32 I = 0; I < 4; ++I) Put(Place.OnSide(1, 2 + I * 1.0, -1.0), TEXT("Prop.StoneBlock"), M(TEXT("StoneWallBlock")), 0, 55, .7);
            Put(Place.OnSide(3, Place.Length(3) * .5, 2.2), TEXT("Prop.Cart"), V(TEXT("SM_Cart_Var01")), 90, 170, 1.6);
        } else if (Place.Type == TEXT("farm")) {
            // Harvest kept at the field edge: haystacks, a cart, barrels and sacks outside the fence.
            Put(Place.OnSide(0, 1.5, 2.6), TEXT("Prop.HayStack"), V(TEXT("SM_Hay_Stack")), Random.FRand() * 360, 260, 2.0);
            Put(Place.OnSide(0, 4.2, 2.3), TEXT("Prop.HayBale"), M(TEXT("HeyStackCylinder")), 0, 140, 1.4);
            Put(Place.OnSide(2, Place.Length(2) - 2.0, 2.4), TEXT("Prop.HayBale"), M(TEXT("HeyStackSquare")), 90, 110, 1.4);
            Put(Place.OnSide(1, Place.Length(1) * .5, 3.2), TEXT("Prop.Cart"), V(TEXT("SM_Cart_Var02")), 20, 165, 1.8);
            for (int32 I = 0; I < 3; ++I) Put(Place.OnSide(3, 1.5 + I * .7, 1.2), TEXT("Prop.CropSack"), V(TEXT("SM_SackWithPotatoes")), Random.FRand() * 360, 65, .7);
            Put(Place.OnSide(3, 4.0, 1.1), TEXT("Prop.Barrel"), M(TEXT("Barrle1")), 0, 95, .7);
            Put(Place.OnSide(3, 4.9, 1.2), TEXT("Prop.Pitchfork"), V(TEXT("SM_Pitchfork")), 40, 150, .7);
        }
    }
}
