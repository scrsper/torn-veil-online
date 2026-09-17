#include "TVEnvironmentGrammar.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"

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
