#include "TVPlayableLighting.h"
#include "EngineUtils.h"
#include "Engine/DirectionalLight.h"
#include "Engine/SkyLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/GameViewportClient.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "HAL/IConsoleManager.h"
#include "TVRenderedFrameCheck.h"
#include "ImageUtils.h"
#include "ImageCore.h"

namespace {
constexpr float SunLux = 12000.f;
constexpr float DaylightEV100 = 12.f;
// Interiors adapt down to EV100 7 so a lantern-lit room reads; daylight exteriors still meter at 12.
constexpr float InteriorEV100 = 7.f;
// A lower afternoon sun models facades and terrain; overhead light flattens them.
const FRotator SunRotation(-36,-35,0);
template<class T> TArray<T*> Find(UWorld* World) {
    TArray<T*> Result;
    for (TActorIterator<T> It(World); It; ++It) Result.Add(*It);
    return Result;
}

template<class T> T* FindOrSpawn(UWorld* World) {
    auto Actors = Find<T>(World);
    return Actors.IsEmpty() ? World->SpawnActor<T>() : Actors[0];
}
bool CVarIs(const TCHAR* Name, int32 Value) {
    const auto* CVar = IConsoleManager::Get().FindConsoleVariable(Name);
    return CVar && CVar->GetInt() == Value;
}
}

FString UTVPlayableLighting::RenderedFrameDiagnostics(const FString& Path) {
    FImage Image;
    if (!FImageUtils::LoadImage(*Path,Image)) {
        FTVRenderedFrameCheck Result; Result.Error=TEXT("Cannot load completed screenshot"); return Result.Json();
    }
    Image.ChangeFormat(ERawImageFormat::BGRA8,EGammaSpace::sRGB);
    return FTVRenderedFrameCheck::Measure(Image.AsBGRA8(),Image.SizeX,Image.SizeY).Json();
}

FString UTVPlayableLighting::EnsureDaylight(UWorld* World) {
    if (!World) return TEXT("No presentation world");
    if (Find<ADirectionalLight>(World).Num()>1 || Find<ASkyLight>(World).Num()>1 ||
        Find<ASkyAtmosphere>(World).Num()>1 || Find<APostProcessVolume>(World).Num()>1 ||
        Find<AExponentialHeightFog>(World).Num()>1)
        return TEXT("Duplicate global lighting actors; repair the generic presentation level");
    auto* Sun = FindOrSpawn<ADirectionalLight>(World);
    auto* Sky = FindOrSpawn<ASkyLight>(World);
    auto* Atmosphere = FindOrSpawn<ASkyAtmosphere>(World);
    auto* Fog = FindOrSpawn<AExponentialHeightFog>(World);
    auto* Post = FindOrSpawn<APostProcessVolume>(World);
    if (!Sun || !Sky || !Atmosphere || !Fog || !Post) return TEXT("Could not create daylight infrastructure");
    auto* Light = CastChecked<UDirectionalLightComponent>(Sun->GetLightComponent());
    Light->SetMobility(EComponentMobility::Movable);
    Light->bAffectsWorld = true;
    Light->SetVisibility(true);
    Light->SetLightColor(FLinearColor::White);
    Light->SetIntensity(SunLux);
    Light->SetAtmosphereSunLight(true);
    Sun->SetActorHiddenInGame(false);
    Sun->SetActorRotation(SunRotation);
    auto* SkyLight = Sky->GetLightComponent();
    SkyLight->SetMobility(EComponentMobility::Movable);
    SkyLight->bAffectsWorld = true;
    SkyLight->SetVisibility(true);
    SkyLight->SetLightColor(FLinearColor::White);
    SkyLight->SourceType = SLS_CapturedScene;
    SkyLight->SetIntensity(1.f);
    SkyLight->SetRealTimeCapture(true);
    SkyLight->MarkRenderStateDirty();
    Sky->SetActorHiddenInGame(false);
    Atmosphere->SetActorHiddenInGame(false);
    Atmosphere->GetRootComponent()->SetVisibility(true);
    Fog->SetActorLocation(FVector(0,0,-1000));
    Fog->GetComponent()->SetFogDensity(.014f);
    // Aerial depth: distant woods soften into the sky instead of ending at a hard horizon.
    Fog->GetComponent()->SetFogHeightFalloff(.05f);
    Fog->GetComponent()->SetStartDistance(4000.f);
    Post->bEnabled = true;
    Post->bUnbound = true;
    Post->BlendWeight = 1.f;
    Post->Priority = 0.f;
    // Stale per-level color grading must not define the neutral baseline.
    Post->Settings = FPostProcessSettings();
    auto& Settings = Post->Settings;
    Settings.bOverride_AutoExposureMethod = true;
    Settings.AutoExposureMethod = AEM_Histogram;
    Settings.bOverride_AutoExposureMinBrightness = true;
    Settings.bOverride_AutoExposureMaxBrightness = true;
    Settings.AutoExposureMinBrightness = InteriorEV100;
    Settings.AutoExposureMaxBrightness = DaylightEV100;
    Settings.bOverride_AutoExposureBias = true;
    Settings.AutoExposureBias = 1.f;
    return ValidateDaylight(World);
}

FString UTVPlayableLighting::ValidateDaylight(UWorld* World, bool RequireLitViewport) {
    if (!World) return TEXT("No presentation world");
    const auto Suns=Find<ADirectionalLight>(World);
    const auto Skies=Find<ASkyLight>(World);
    const auto Atmospheres=Find<ASkyAtmosphere>(World);
    const auto Posts=Find<APostProcessVolume>(World);
    if (Suns.Num()!=1 || Skies.Num()!=1 || Atmospheres.Num()!=1 || Posts.Num()!=1)
        return TEXT("Expected exactly one directional light, skylight, sky atmosphere and post-process volume");
    const auto* Sun=CastChecked<UDirectionalLightComponent>(Suns[0]->GetLightComponent());
    if (Sun->Mobility!=EComponentMobility::Movable || !Sun->bAffectsWorld || !Sun->IsVisible() ||
        Suns[0]->IsHidden() || !Sun->bAtmosphereSunLight || !FMath::IsNearlyEqual(Sun->Intensity,SunLux) ||
        !Suns[0]->GetActorRotation().Equals(SunRotation,.1f))
        return TEXT("Directional light is not the 12000-lux movable daylight baseline");
    const auto* Sky=Skies[0]->GetLightComponent();
    if (Sky->Mobility!=EComponentMobility::Movable || !Sky->bAffectsWorld || !Sky->IsVisible() ||
        Skies[0]->IsHidden() || !Sky->bRealTimeCapture || Sky->SourceType!=SLS_CapturedScene ||
        !FMath::IsNearlyEqual(Sky->Intensity,1.f))
        return TEXT("Skylight must be visible, movable and capture the live atmosphere at intensity 1");
    if (Atmospheres[0]->IsHidden() || !Atmospheres[0]->GetRootComponent()->IsVisible())
        return TEXT("Sky atmosphere is hidden");
    const auto* Post=Posts[0];
    const auto& S=Post->Settings;
    if (!Post->bEnabled || !Post->bUnbound || !FMath::IsNearlyEqual(Post->BlendWeight,1.f) ||
        !S.bOverride_AutoExposureMethod || S.AutoExposureMethod!=AEM_Histogram ||
        !S.bOverride_AutoExposureMinBrightness || !S.bOverride_AutoExposureMaxBrightness ||
        !FMath::IsNearlyEqual(S.AutoExposureMinBrightness,InteriorEV100) ||
        !FMath::IsNearlyEqual(S.AutoExposureMaxBrightness,DaylightEV100) ||
        !S.bOverride_AutoExposureBias || !FMath::IsNearlyEqual(S.AutoExposureBias,1.f))
        return TEXT("Post-process exposure must be unbound, enabled, EV100 7-12 with compensation +1");
    if (!CVarIs(TEXT("r.DefaultFeature.AutoExposure.ExtendDefaultLuminanceRange"),1) ||
        !CVarIs(TEXT("r.DynamicGlobalIlluminationMethod"),1) ||
        !CVarIs(TEXT("r.ReflectionMethod"),1) || !CVarIs(TEXT("r.Lumen.DiffuseIndirect.Allow"),1))
        return TEXT("Expected extended EV100 exposure and enabled Lumen GI/reflections");
    if (RequireLitViewport && (!World->GetGameViewport() || World->GetGameViewport()->ViewModeIndex!=VMI_Lit))
        return TEXT("PIE acceptance requires a real Lit game viewport (Unlit is not a fix)");
    return FString();
}
