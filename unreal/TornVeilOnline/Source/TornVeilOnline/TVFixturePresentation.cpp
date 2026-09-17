#include "TVFixturePresentation.h"

namespace
{
    constexpr TCHAR Cube[] = TEXT("/Engine/BasicShapes/Cube.Cube");

    FTVFixturePiece Piece(const TCHAR* MeshRole, const TCHAR* MaterialRole, const FVector& Offset, const FVector& Size, float Yaw = 0.f)
    {
        FTVFixturePiece Out;
        Out.MeshRole = MeshRole;
        Out.MaterialRole = MaterialRole;
        Out.FallbackMesh = Cube;
        Out.CenterOffsetCm = Offset;
        Out.SizeCm = Size;
        Out.Yaw = Yaw;
        return Out;
    }
}

TArray<FTVFixturePiece> FTVFixturePresentation::Describe(const FString& Role)
{
    FString Key = Role.TrimStartAndEnd().ToLower();
    if (Key.StartsWith(TEXT("fixture."))) Key.RightChopInline(8);
    TArray<FTVFixturePiece> Out;
    if (Key == TEXT("bed")) {
        Out.Add(Piece(TEXT("Fixture.Bed.Frame"), TEXT("Fixture.Bed.Material"), FVector(0, 0, 8), FVector(88, 42, 16)));
        Out.Add(Piece(TEXT("Fixture.Bed.Cloth"), TEXT("Fixture.Bed.Textile"), FVector(0, 0, 18), FVector(80, 36, 8)));
    } else if (Key == TEXT("chair")) {
        Out.Add(Piece(TEXT("Fixture.Chair"), TEXT("Fixture.Chair.Material"), FVector(0, 0, 47.5f), FVector(55, 55, 95)));
    } else if (Key == TEXT("table")) {
        Out.Add(Piece(TEXT("Fixture.Table"), TEXT("Fixture.Table.Material"), FVector(0, 0, 39), FVector(90, 90, 78)));
    } else if (Key == TEXT("counter")) {
        Out.Add(Piece(TEXT("Fixture.Counter"), TEXT("Fixture.Counter.Material"), FVector(0, 0, 47.5f), FVector(90, 75, 95)));
    } else if (Key == TEXT("bench")) {
        Out.Add(Piece(TEXT("Fixture.Bench"), TEXT("Fixture.Bench.Material"), FVector(0, 0, 25), FVector(90, 40, 50)));
    } else if (Key == TEXT("anvil")) {
        Out.Add(Piece(TEXT("Fixture.Anvil"), TEXT("Fixture.Anvil.Material"), FVector(0, 0, 32), FVector(58, 48, 64)));
    } else if (Key == TEXT("forge")) {
        Out.Add(Piece(TEXT("Fixture.Forge"), TEXT("Fixture.Forge.Material"), FVector(0, 0, 45), FVector(90, 90, 90)));
    } else if (Key == TEXT("altar")) {
        Out.Add(Piece(TEXT("Fixture.Altar"), TEXT("Fixture.Altar.Material"), FVector(0, 0, 40), FVector(90, 60, 80)));
    } else if (Key == TEXT("shelf")) {
        Out.Add(Piece(TEXT("Fixture.Shelf"), TEXT("Fixture.Shelf.Material"), FVector(0, 0, 45), FVector(90, 28, 90)));
    } else if (Key == TEXT("barrel")) {
        Out.Add(Piece(TEXT("Fixture.Barrel"), TEXT("Fixture.Barrel.Material"), FVector(0, 0, 45), FVector(70, 70, 90)));
    } else if (Key == TEXT("crate")) {
        Out.Add(Piece(TEXT("Fixture.Crate"), TEXT("Fixture.Crate.Material"), FVector(0, 0, 35), FVector(70, 70, 70)));
    } else if (Key == TEXT("lantern")) {
        Out.Add(Piece(TEXT("Fixture.Lantern"), TEXT("Fixture.Lantern.Material"), FVector(0, 0, 45), FVector(30, 30, 60)));
    } else if (Key == TEXT("sign")) {
        Out.Add(Piece(TEXT("Fixture.Sign"), TEXT("Fixture.Sign.Material"), FVector(0, 0, 40), FVector(90, 15, 80)));
    } else if (Key == TEXT("well")) {
        Out.Add(Piece(TEXT("Fixture.Well"), TEXT("Fixture.Well.Material"), FVector(0, 0, 35), FVector(96, 96, 70)));
    }
    return Out;
}
