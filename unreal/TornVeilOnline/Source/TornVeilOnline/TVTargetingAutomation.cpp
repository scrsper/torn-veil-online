#include "TVBridgeSubsystem.h"
#include "TVCharacter.h"
#include "TVWildlifePresentation.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "Engine/World.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVSemanticTargeting,"TornVeil.Presentation.SemanticTargeting",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FTVSemanticTargeting::RunTest(const FString&) {
    auto* World=UWorld::CreateWorld(EWorldType::Editor,false);
    auto* Bridge=NewObject<UTVBridgeSubsystem>(World);
    FActorSpawnParameters Params;Params.SpawnCollisionHandlingOverride=ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
    auto* Player=World->SpawnActor<ATVCharacter>(FVector(0,0,100),FRotator::ZeroRotator,Params);
    auto* Human=World->SpawnActor<ATVCharacter>(FVector(500,0,100),FRotator::ZeroRotator,Params);
    auto* Animal=World->SpawnActor<ATVWildlifePresentation>(FVector(200,0,100),FRotator::ZeroRotator,Params);
    Player->SetActorEnableCollision(false);Human->SetActorEnableCollision(false);Animal->SetActorEnableCollision(false);
    Bridge->Bodies.Add(TEXT("human"),Human);Bridge->WildlifeBodies.Add(TEXT("animal"),Animal);Bridge->SelectedBody=TEXT("human");
    Player->bTargetLocked=true;
    TestEqual(TEXT("hard lock directs attack"),Bridge->LockedTargetBody(Player),FString(TEXT("human")));
    TestEqual(TEXT("ability honors locked human despite nearer animal"),Bridge->AbilityTargetBody(Player),FString(TEXT("human")));
    Bridge->SelectedBody=TEXT("animal");
    TestEqual(TEXT("wildlife can be locked"),Bridge->LockedTargetBody(Player),FString(TEXT("animal")));
    Player->bTargetLocked=false;Bridge->SelectedBody=TEXT("human");
    TestTrue(TEXT("released lock leaves attack free of stale selection"),Bridge->LockedTargetBody(Player).IsEmpty());
    TestEqual(TEXT("unlocked ability aims at nearer forward animal"),Bridge->AbilityTargetBody(Player),FString(TEXT("animal")));
    Animal->bAlive=false;
    TestEqual(TEXT("carcass does not steal ability selection"),Bridge->AbilityTargetBody(Player),FString(TEXT("human")));
    Human->SetActorLocation(FVector(-500,0,100));
    TestTrue(TEXT("unlocked ability does not aim behind the player"),Bridge->AbilityTargetBody(Player).IsEmpty());
    Player->bTargetLocked=true;Human->bIncapacitated=true;
    TestTrue(TEXT("incapacitated target cannot retain combat lock"),Bridge->LockedTargetBody(Player).IsEmpty());
    World->DestroyWorld(false);return true;
}
#endif
