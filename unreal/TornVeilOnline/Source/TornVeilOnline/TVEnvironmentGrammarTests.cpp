#include "TVEnvironmentGrammar.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "TVWorldProjection.h"
#include "Components/BoxComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/World.h"
#include "Engine/StaticMesh.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Serialization/JsonSerializer.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVRegionalDressingClearanceTest, "TornVeil.Presentation.RegionalDressingClearance", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVRegionalDressingClearanceTest::RunTest(const FString&) {
    // Retained seed-918271 square geometry: decorative table benches crossed the
    // canonical arrival/activity point despite there being no furniture in its voxel cells.
    const FString Fixture=TEXT(R"({"places":[{"type":"square","family":"workshop","bounds":{"x0":12033,"z0":20006,"x1":12046,"z1":20019,"y0":24},"inside":{"x":12035,"y":24,"z":20008},"indoor":false,"visualSeed":2477659849}],"paths":[],"fences":[]})");
    TSharedPtr<FJsonObject> Input;
    if(!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Fixture),Input)) return false;
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);
    auto* Region=World->SpawnActor<ATVRegionProjection>();
    Region->CanonicalBase=FVector(12032,19968,0);
    Region->SetActorLocation(FVector(5000,7000,0));
    Region->DressPlaces(Input);
    TestTrue(TEXT("keeps grounded exterior decoration"),Region->DecorativeCount>0);
    const FVector Arrival=FVector(1203500,2000800,2400)-Region->CanonicalBase*100+Region->GetActorLocation();
    int32 Instances=0;
    for(const auto& Pair:Region->Batches) {
        const auto* Batch=Pair.Value.Get();
        if(!Batch || !Batch->GetStaticMesh()) continue;
        TestEqual(TEXT("dressing never adds physical collision"),Batch->GetCollisionEnabled(),ECollisionEnabled::NoCollision);
        TestFalse(TEXT("dressing never changes navigation"),Batch->CanEverAffectNavigation());
        for(int32 I=0;I<Batch->GetInstanceCount();++I) {
            FTransform Transform; Batch->GetInstanceTransform(I,Transform,true);
            const FBox Bounds=Batch->GetStaticMesh()->GetBoundingBox().TransformBy(Transform);
            for(int32 Slot=0;Slot<8;++Slot) {
                const FVector Point=Arrival+(Slot?FVector((Slot%4-1.5)*100,(Slot/4+1)*100,0):FVector::ZeroVector);
                const bool CoversArrival=Bounds.Min.X<Point.X+40 && Bounds.Max.X>Point.X-40 && Bounds.Min.Y<Point.Y+40 && Bounds.Max.Y>Point.Y-40;
                TestFalse(*FString::Printf(TEXT("%s leaves arrival slot %d clear"),*Batch->GetStaticMesh()->GetName(),Slot),CoversArrival);
            }
            ++Instances;
        }
    }
    TestTrue(TEXT("measures actual installed prop instances"),Instances>0);
    World->DestroyWorld(false); return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVRegionalCameraCollisionTest, "TornVeil.Presentation.RegionalCameraCollision", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVRegionalCameraCollisionTest::RunTest(const FString&) {
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);
    auto* Region=World->SpawnActor<ATVRegionProjection>();
    Region->CanonicalBase=FVector(200,300,0);
    Region->SetActorLocation(FVector(5000,7000,0));
    auto Place=MakeShared<FJsonObject>();
    Place->SetStringField(TEXT("id"),TEXT("camera_fixture"));
    Place->SetStringField(TEXT("family"),TEXT("dwelling"));
    Place->SetStringField(TEXT("type"),TEXT("house"));
    Place->SetBoolField(TEXT("indoor"),true);
    Place->SetNumberField(TEXT("wallHeight"),4);
    auto Bounds=MakeShared<FJsonObject>();
    Bounds->SetNumberField(TEXT("x0"),200); Bounds->SetNumberField(TEXT("x1"),205);
    Bounds->SetNumberField(TEXT("z0"),300); Bounds->SetNumberField(TEXT("z1"),307);
    Bounds->SetNumberField(TEXT("y0"),0); Place->SetObjectField(TEXT("bounds"),Bounds);
    auto Door=MakeShared<FJsonObject>();
    Door->SetNumberField(TEXT("x"),202); Door->SetNumberField(TEXT("z"),300); Door->SetNumberField(TEXT("y"),0);
    Place->SetObjectField(TEXT("door"),Door);
    Region->Structure(Place);
    TestTrue(TEXT("wall spans, lintel, floor, ceiling and roof slopes"),Region->CameraBlocks.Num()>8);
    for(const UBoxComponent* Block:Region->CameraBlocks) {
        TestEqual(TEXT("camera blockers query only"),Block->GetCollisionEnabled(),ECollisionEnabled::QueryOnly);
        TestFalse(TEXT("never changes navigation"),Block->CanEverAffectNavigation());
        for(int32 Channel=0;Channel<ECC_MAX;++Channel)
            TestEqual(TEXT("only camera responds"),Block->GetCollisionResponseToChannel(static_cast<ECollisionChannel>(Channel)),Channel==ECC_Camera?ECR_Block:ECR_Ignore);
    }
    const auto Hits=[&](const FVector& A,const FVector& B,ECollisionChannel Channel=ECC_Camera) {
        FHitResult Hit; return World->LineTraceSingleByChannel(Hit,A,B,Channel);
    };
    const FVector Inside(5250,7400,160);
    TestTrue(TEXT("camera stops at wall with a rebased region"),Hits(Inside,FVector(4900,7400,160)));
    TestTrue(TEXT("camera stops at ceiling"),Hits(Inside,FVector(5250,7400,500)));
    TestTrue(TEXT("camera stops at floor"),Hits(Inside,FVector(5250,7400,-100)));
    TestFalse(TEXT("door remains open"),Hits(Inside,FVector(5250,6900,160)));
    TestTrue(TEXT("lintel remains solid above door"),Hits(FVector(5250,7400,280),FVector(5250,6900,280)));
    TestFalse(TEXT("no independent pawn collision authority"),Hits(Inside,FVector(4900,7400,160),ECC_Pawn));
    auto* Stall=World->SpawnActor<ATVRegionProjection>();
    Stall->CanonicalBase=Region->CanonicalBase; Stall->SetActorLocation(FVector(8000,7000,0));
    Place->SetStringField(TEXT("type"),TEXT("stall")); Place->SetBoolField(TEXT("indoor"),false); Place->SetNumberField(TEXT("wallHeight"),2);
    Stall->Structure(Place);
    TestTrue(TEXT("open stall roof stops camera"),Hits(FVector(8300,7400,160),FVector(8300,7400,500)));
    FHitResult Underside;
    World->LineTraceSingleByChannel(Underside,FVector(8300,7400,160),FVector(8300,7400,500),ECC_Camera);
    TestTrue(TEXT("closed kit roof underside blocks below its eaves"),Underside.bBlockingHit && Underside.ImpactPoint.Z<205);
    TestFalse(TEXT("open stall has no invented side walls"),Hits(FVector(8300,7400,160),FVector(7900,7400,160)));
    World->DestroyWorld(false);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVEnvironmentRoofTest, "TornVeil.Presentation.EnvironmentRoof", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVEnvironmentRoofTest::RunTest(const FString&) {
    for (FVector2D Size : {FVector2D(600,800),FVector2D(1200,1100),FVector2D(800,600)}) {
        const FVector Origin(1203300,2000600,2400);
        const auto Parts=FTVEnvironmentGrammar::Roof(Origin,Size,400);
        TestTrue(TEXT("paired slopes, not a stretched complete house"),Parts.Num()>=4 && Parts.Num()%2==0);
        FBox Envelope(ForceInit);
        for(const auto& P:Parts) {
            const FBox Local(-P.Size/2,P.Size/2);
            Envelope+=Local.TransformBy(FTransform(FRotator(0,P.Yaw,0),P.Center));
            TestTrue(TEXT("panel bays retain sensible width"),P.Size.X<=222.01);
            TestTrue(TEXT("roof eaves meet wall top"),FMath::IsNearlyEqual(P.Center.Z-P.Size.Z/2,Origin.Z+397,.01));
        }
        TestTrue(TEXT("roof covers canonical walls"),Envelope.Min.X<=Origin.X && Envelope.Min.Y<=Origin.Y && Envelope.Max.X>=Origin.X+Size.X && Envelope.Max.Y>=Origin.Y+Size.Y);
        TestTrue(TEXT("bounded roof leaves alleys open"),Envelope.Min.X>=Origin.X-27 && Envelope.Min.Y>=Origin.Y-27 && Envelope.Max.X<=Origin.X+Size.X+27 && Envelope.Max.Y<=Origin.Y+Size.Y+27);
    }
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVEnvironmentRoutesTest, "TornVeil.Presentation.EnvironmentRoutes", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVEnvironmentRoutesTest::RunTest(const FString&) {
    TSet<FIntPoint> Paths; for(int X=253;X<259;X++) Paths.Add(FIntPoint(X,12));
    const TArray<FTVSurfaceRoute> Empty;
    TestEqual(TEXT("cell joins are fully worn"),FTVEnvironmentGrammar::WornGround(FVector2D(256,12.5),Paths,Empty),1.f);
    TestEqual(TEXT("clear land stays unworn"),FTVEnvironmentGrammar::WornGround(FVector2D(256,16),Paths,Empty),0.f);
    const float Shoulder=FTVEnvironmentGrammar::WornGround(FVector2D(256,13.5),Paths,Empty);
    TestTrue(TEXT("shoulder feathers into ground"),Shoulder>0 && Shoulder<1);
    TArray<FTVSurfaceRoute> Road{{FVector2D(0,0),FVector2D(20,20),1.6f}};
    TestEqual(TEXT("diagonal road follows its actual segment"),FTVEnvironmentGrammar::WornGround(FVector2D(9,9),{},Road),1.f);
    TestEqual(TEXT("does not extend a road beyond its destination"),FTVEnvironmentGrammar::WornGround(FVector2D(25,25),{},Road),0.f);
    TestEqual(TEXT("world anchored cluster is repeatable"),FTVEnvironmentGrammar::Cluster(FVector2D(256,12),1),FTVEnvironmentGrammar::Cluster(FVector2D(256,12),1));
    return true;
}
#endif
