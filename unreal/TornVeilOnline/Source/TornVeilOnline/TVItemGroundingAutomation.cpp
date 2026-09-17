#include "TVItemPresentationCatalog.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVItemGrounding,"TornVeil.Presentation.ItemGrounding",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FTVItemGrounding::RunTest(const FString&) {
    for(const TCHAR* Type:{TEXT("bread"),TEXT("lantern"),TEXT("sword"),TEXT("book"),TEXT("log"),TEXT("stick"),TEXT("stone"),TEXT("unknown")}) {
        const auto D=FTVItemPresentationCatalog::Describe(Type);
        TestTrue(FString::Printf(TEXT("%s rests on canonical support plane"),Type),FMath::IsNearlyZero(D.HeightOffset-D.Size.Z*.5));
    }
    for(bool Open:{false,true}) {
        const auto D=FTVItemPresentationCatalog::DescribeContainer(Open);
        TestTrue(Open?TEXT("open chest is grounded, not floating 24cm"):TEXT("closed chest is grounded"),FMath::IsNearlyZero(D.HeightOffset-D.Size.Z*.5));
    }
    return true;
}
#endif
