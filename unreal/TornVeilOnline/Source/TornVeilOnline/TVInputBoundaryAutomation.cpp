#include "TVBridgeSubsystem.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "Engine/World.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVInputBoundaryReset,
    "TornVeil.Presentation.InputBoundaryReset", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVInputBoundaryReset::RunTest(const FString&) {
    auto* World=UWorld::CreateWorld(EWorldType::Game,false);
    auto* Bridge=NewObject<UTVBridgeSubsystem>(World);
    Bridge->BufferedCombat=UTVBridgeSubsystem::FBufferedCombat();
    Bridge->bCrouchHeld=true;
    Bridge->PredictedCombat=FTVLiveCombat::Predict(TEXT("attack"),0,1,TEXT("already-accepted"));
    Bridge->ClearBufferedInput();
    TestFalse(TEXT("old follow-up cannot replay after input boundary"),Bridge->BufferedCombat.IsSet());
    TestFalse(TEXT("held crouch does not survive input boundary"),Bridge->bCrouchHeld);
    TestEqual(TEXT("input flush does not cancel an accepted action"),Bridge->PredictedCombat.Id,FString(TEXT("already-accepted")));
    Bridge->bControls=false;Bridge->bPredictionReady=true;
    Bridge->bTransportConnected=true;Bridge->bCanonicalReady=true;Bridge->LastSnapshotReceived=FPlatformTime::Seconds();
    TestFalse(TEXT("observer cannot predict even with live snapshots"),Bridge->HasPrediction());
    Bridge->bControls=true;Bridge->bTransportConnected=false;
    TestFalse(TEXT("disconnected client cannot predict"),Bridge->HasPrediction());
    World->DestroyWorld(false);return true;
}
#endif
