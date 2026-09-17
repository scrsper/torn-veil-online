#include "TVWildlifePresentation.h"

#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "Dom/JsonObject.h"
#include "Engine/World.h"
#include "Engine/SkeletalMesh.h"
#include "Animation/AnimSequence.h"
#include "Components/SkeletalMeshComponent.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace {
TSharedPtr<FJsonObject> DeerRow(bool bAlive=true, bool bDead=false, bool bPresent=true, const TCHAR* Activity=TEXT("walk")) {
    auto Row=MakeShared<FJsonObject>();
    Row->SetStringField(TEXT("bodyId"),TEXT("body:roe-deer-1")); Row->SetStringField(TEXT("creatureId"),TEXT("creature:roe-deer-1"));
    Row->SetStringField(TEXT("speciesId"),TEXT("roe_deer")); Row->SetStringField(TEXT("regionId"),TEXT("0,0")); Row->SetStringField(TEXT("activity"),Activity);
    Row->SetBoolField(TEXT("alive"),bAlive); Row->SetBoolField(TEXT("dead"),bDead); Row->SetBoolField(TEXT("present"),bPresent);
    Row->SetNumberField(TEXT("condition"),bDead?0.:1.); Row->SetNumberField(TEXT("yaw"),0.); Row->SetNumberField(TEXT("scale"),1.);
    auto P=MakeShared<FJsonObject>(); P->SetNumberField(TEXT("x"),100.); P->SetNumberField(TEXT("y"),16.); P->SetNumberField(TEXT("z"),100.); Row->SetObjectField(TEXT("pos"),P);
    auto V=MakeShared<FJsonObject>(); V->SetNumberField(TEXT("x"),1.); V->SetNumberField(TEXT("y"),0.); V->SetNumberField(TEXT("z"),0.); Row->SetObjectField(TEXT("vel"),V);
    auto Plan=MakeShared<FJsonObject>(); Plan->SetNumberField(TEXT("heightM"),1.5); Row->SetObjectField(TEXT("bodyPlan"),Plan); return Row;
}
TSharedPtr<FJsonObject> Diagnostics(const ATVWildlifePresentation& Actor) {
    TSharedPtr<FJsonObject> Json; const auto Text=Actor.PresentationDiagnostics(); const auto Reader=TJsonReaderFactory<>::Create(Text); FJsonSerializer::Deserialize(Reader,Json); return Json;
}
UWorld* TestWorld() { return UWorld::CreateWorld(EWorldType::Game,false); }
ATVWildlifePresentation* SpawnDeer(UWorld* World) { return World ? World->SpawnActor<ATVWildlifePresentation>() : nullptr; }
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVRoeDeerAssets,
    "TornVeil.Presentation.Wildlife.RoeDeerAssets", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVRoeDeerAssets::RunTest(const FString&) {
    const TCHAR* MeshPath=TEXT("/Game/TornVeil/Wildlife/Deer/SKM_Deer.SKM_Deer");
    TestNotNull(TEXT("CC0 roe deer skeletal mesh is imported"),LoadObject<USkeletalMesh>(nullptr,MeshPath));
    for(const TCHAR* Name:{TEXT("Idle"),TEXT("Walk"),TEXT("Gallop"),TEXT("Eating"),TEXT("Death"),TEXT("Idle_Headlow")}) {
        const FString Path=FString::Printf(TEXT("/Game/TornVeil/Wildlife/Deer/AN_Deer_%s.AN_Deer_%s"),Name,Name);
        TestNotNull(*FString::Printf(TEXT("CC0 roe deer clip %s is imported"),Name),LoadObject<UAnimSequence>(nullptr,*Path));
    }
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVRoeDeerPresentationAuthority,
    "TornVeil.Presentation.Wildlife.RoeDeerAuthority", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVRoeDeerPresentationAuthority::RunTest(const FString&) {
    auto* World=TestWorld(); auto* Actor=SpawnDeer(World);
    TestNotNull(TEXT("wildlife presentation actor constructs"),Actor);
    if(!Actor){ if(World)World->DestroyWorld(false); return false; }
    TestNotNull(TEXT("skeletal mesh component exists"),Actor->Mesh.Get());
    if(Actor->Mesh) {
        TestEqual(TEXT("wildlife has no collision authority"),Actor->Mesh->GetCollisionEnabled(),ECollisionEnabled::NoCollision);
        TestFalse(TEXT("wildlife cannot affect navigation"),Actor->Mesh->CanEverAffectNavigation());
        TestFalse(TEXT("wildlife physics is disabled"),Actor->Mesh->IsSimulatingPhysics());
    }
    TestTrue(TEXT("actor root is a presentation scene root"),Actor->GetRootComponent() && Actor->GetRootComponent()->GetAttachParent()==nullptr);
    World->DestroyWorld(false); return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVRoeDeerSnapshotContinuity,
    "TornVeil.Presentation.Wildlife.RoeDeerSnapshotContinuity", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVRoeDeerSnapshotContinuity::RunTest(const FString&) {
    auto* World=TestWorld(); auto* Actor=SpawnDeer(World); if(!Actor){ if(World)World->DestroyWorld(false); return false; }
    const FVector Origin(0,0,0); TestTrue(TEXT("initial canonical row projects"),Actor->Project(DeerRow(),Origin,100.f,true)); Actor->Tick(.10f);
    const double Before=Diagnostics(*Actor)->GetNumberField(TEXT("animationTime"));
    TestTrue(TEXT("repeated canonical row projects"),Actor->Project(DeerRow(),Origin,100.f,false)); Actor->Tick(.10f);
    const double After=Diagnostics(*Actor)->GetNumberField(TEXT("animationTime"));
    TestTrue(TEXT("repeated snapshot advances animation instead of rewinding"),After>Before);
    World->DestroyWorld(false); return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVRoeDeerTerminalAndAbsence,
    "TornVeil.Presentation.Wildlife.RoeDeerTerminalAndAbsence", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVRoeDeerTerminalAndAbsence::RunTest(const FString&) {
    auto* World=TestWorld(); auto* Actor=SpawnDeer(World); if(!Actor){ if(World)World->DestroyWorld(false); return false; }
    TestTrue(TEXT("initial dead canonical row projects"),Actor->Project(DeerRow(false,true,true,TEXT("dead")),FVector::ZeroVector,100.f,true));
    auto Dead=Diagnostics(*Actor); const auto* Death=LoadObject<UAnimSequence>(nullptr,TEXT("/Game/TornVeil/Wildlife/Deer/AN_Deer_Death.AN_Deer_Death"));
    TestNotNull(TEXT("death clip is available"),Death); if(Death)TestTrue(TEXT("dead projection starts at final death clip pose"),FMath::IsNearlyEqual(Dead->GetNumberField(TEXT("animationTime")),Death->GetPlayLength(),.001)); TestTrue(TEXT("dead body remains present"),Actor->bPresent); TestTrue(TEXT("dead body is marked dead"),Actor->bDead);
    TestTrue(TEXT("absence projection projects"),Actor->Project(DeerRow(true,false,false),FVector::ZeroVector,100.f,false));
    TestFalse(TEXT("absence is not death"),Actor->bDead); TestFalse(TEXT("absence is not present"),Actor->bPresent); TestTrue(TEXT("absent deer is hidden"),Actor->IsHidden());
    World->DestroyWorld(false); return true;
}
#endif
