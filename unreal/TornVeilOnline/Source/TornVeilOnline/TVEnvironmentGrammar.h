#pragma once
#include "CoreMinimal.h"

/** Disposable presentation recipes. Inputs and outputs are metres, except roof pieces (cm).
 * These helpers never change canonical geometry, destinations or collision. */
struct FTVRoofPanel {
    FVector Center;
    FVector Size;
    float Yaw = 0;
};
struct FTVSurfaceRoute { FVector2D A, B; float HalfWidth = 1.6f; };

struct FTVEnvironmentGrammar {
    static TArray<FTVRoofPanel> Roof(const FVector& BaseCm, const FVector2D& FootprintCm, float WallHeightCm);
    static float RouteDistance(const FVector2D& Point, const FTVSurfaceRoute& Route);
    static float WornGround(const FVector2D& Point, const TSet<FIntPoint>& Paths, const TArray<FTVSurfaceRoute>& Routes);
    static float Cluster(const FVector2D& Point, int32 Seed);
    static void ReloadPalette();
    static FString Asset(const TCHAR* Role, const TCHAR* Fallback);
};
