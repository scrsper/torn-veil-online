#include "TVHumanoidVisualState.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "Dom/JsonObject.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVHumanoidVisualStateParser,
    "TornVeil.Humanoid.VisualState.Parser", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVHumanoidVisualStateParser::RunTest(const FString&) {
    auto J = MakeShared<FJsonObject>();
    J->SetStringField(TEXT("bodyId"), TEXT("body-a")); J->SetStringField(TEXT("entityId"), TEXT("person-a"));
    J->SetStringField(TEXT("name"), TEXT("Ari")); J->SetStringField(TEXT("activity"), TEXT("walk")); J->SetStringField(TEXT("pose"), TEXT("stand"));
    for (const TCHAR* Key : {TEXT("pos"), TEXT("velocity")}) { auto V = MakeShared<FJsonObject>(); V->SetNumberField(TEXT("x"), 0); V->SetNumberField(TEXT("y"), 0); V->SetNumberField(TEXT("z"), 0); J->SetObjectField(Key, V); }
    J->SetNumberField(TEXT("yaw"), 0); J->SetBoolField(TEXT("dead"), false); J->SetBoolField(TEXT("incapacitated"), true);
    auto Appearance = MakeShared<FJsonObject>(); Appearance->SetNumberField(TEXT("height"), 1.4); Appearance->SetStringField(TEXT("hatStyle"), TEXT("hood")); J->SetObjectField(TEXT("appearance"), Appearance);
    FTVHumanoidVisualState State; FString Error;
    TestTrue(TEXT("valid required projection parses"), FTVHumanoidVisualState::Parse(J, State, Error));
    TestTrue(TEXT("optional counters default safely"), State.AttackSeq == 0 && State.HitSeq == 0);
    TestTrue(TEXT("terminal incapacitation is preserved"), State.bIncapacitated && !State.bDead);
    TestTrue(TEXT("appearance is typed and clamped"), State.Appearance.bPresent && State.Appearance.Height <= 1.16f && State.Appearance.HatStyle == TEXT("hood"));
    J->SetNumberField(TEXT("attackSeq"), 2.5);
    TestTrue(TEXT("fractional optional counter degrades safely"), FTVHumanoidVisualState::Parse(J, State, Error) && State.AttackSeq == 0);
    J->SetStringField(TEXT("bodyId"), TEXT(""));
    TestFalse(TEXT("empty identity is rejected"), FTVHumanoidVisualState::Parse(J, State, Error));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVHumanoidVisualStateEventQueue,
    "TornVeil.Humanoid.VisualState.EventQueue", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVHumanoidVisualStateEventQueue::RunTest(const FString&) {
    TestEqual(TEXT("two attacks between snapshots are preserved"), FTVHumanoidVisualState::PendingDelta(20, 22, 0), 2);
    TestEqual(TEXT("two hits append to existing queue"), FTVHumanoidVisualState::PendingDelta(4, 6, 1), 3);
    TestEqual(TEXT("burst queue is bounded"), FTVHumanoidVisualState::PendingDelta(0, 99, 0), 4);
    TestEqual(TEXT("non-monotonic counters do not replay"), FTVHumanoidVisualState::PendingDelta(8, 7, 0), 0);
    return true;
}
#endif
