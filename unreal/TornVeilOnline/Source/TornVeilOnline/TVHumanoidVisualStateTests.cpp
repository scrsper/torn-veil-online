#include "TVHumanoidVisualState.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"

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

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVHumanoidAppearanceDescription,
    "TornVeil.Humanoid.VisualState.AppearanceDescription", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVHumanoidAppearanceDescription::RunTest(const FString&) {
    auto J = MakeShared<FJsonObject>();
    J->SetStringField(TEXT("bodyId"), TEXT("body-a")); J->SetStringField(TEXT("entityId"), TEXT("person-a"));
    J->SetStringField(TEXT("name"), TEXT("Ari")); J->SetStringField(TEXT("activity"), TEXT("walk")); J->SetStringField(TEXT("pose"), TEXT("stand"));
    for (const TCHAR* Key : {TEXT("pos"), TEXT("velocity")}) { auto V = MakeShared<FJsonObject>(); V->SetNumberField(TEXT("x"), 0); V->SetNumberField(TEXT("y"), 0); V->SetNumberField(TEXT("z"), 0); J->SetObjectField(Key, V); }
    J->SetNumberField(TEXT("yaw"), 0);

    // A body projected without traits stays presentable: colours and scale still arrive.
    auto Appearance = MakeShared<FJsonObject>(); Appearance->SetNumberField(TEXT("shirt"), 0x7a1a24); J->SetObjectField(TEXT("appearance"), Appearance);
    FTVHumanoidVisualState State; FString Error;
    TestTrue(TEXT("appearance without traits still parses"), FTVHumanoidVisualState::Parse(J, State, Error));
    TestFalse(TEXT("absent traits are reported absent"), State.Appearance.Description.bHasDescription);

    auto Description = MakeShared<FJsonObject>();
    Description->SetStringField(TEXT("archetype"), TEXT("shogun"));
    Description->SetStringField(TEXT("garmentSilhouette"), TEXT("hakama_set"));
    Description->SetStringField(TEXT("hairStyle"), TEXT("topknot"));
    Description->SetStringField(TEXT("agePresentation"), TEXT("middle_aged"));
    Description->SetNumberField(TEXT("wear"), 4.2);       // out of range
    Description->SetNumberField(TEXT("grooming"), 0.42);
    TArray<TSharedPtr<FJsonValue>> Accessories;
    Accessories.Add(MakeShared<FJsonValueString>(TEXT("beard")));
    Accessories.Add(MakeShared<FJsonValueString>(TEXT("scabbard")));
    Accessories.Add(MakeShared<FJsonValueNumber>(7)); // not a token; must be dropped, not fatal
    Description->SetArrayField(TEXT("accessories"), Accessories);
    TArray<TSharedPtr<FJsonValue>> RoleCues; RoleCues.Add(MakeShared<FJsonValueString>(TEXT("hammer")));
    Description->SetArrayField(TEXT("roleCues"), RoleCues);
    Appearance->SetObjectField(TEXT("description"), Description);

    TestTrue(TEXT("traits parse"), FTVHumanoidVisualState::Parse(J, State, Error));
    const FTVAppearanceDescription& Parsed = State.Appearance.Description;
    TestTrue(TEXT("traits are reported present"), Parsed.bHasDescription);
    TestEqual(TEXT("archetype survives"), Parsed.Archetype, FString(TEXT("shogun")));
    TestEqual(TEXT("silhouette survives"), Parsed.GarmentSilhouette, FString(TEXT("hakama_set")));
    TestEqual(TEXT("derived age presentation survives"), Parsed.AgePresentation, FString(TEXT("middle_aged")));
    TestTrue(TEXT("out-of-range wear is clamped"), Parsed.Wear <= 1.f && Parsed.Wear >= 0.f);
    TestTrue(TEXT("accessory tokens are kept"), Parsed.HasAccessory(TEXT("beard")) && Parsed.HasAccessory(TEXT("scabbard")));
    TestEqual(TEXT("non-string tokens are dropped, not fatal"), Parsed.Accessories.Num(), 2);
    TestTrue(TEXT("role cues arrive separately from worn accessories"), Parsed.RoleCues.Contains(TEXT("hammer")) && !Parsed.HasAccessory(TEXT("hammer")));

    // A malformed trait block must never cost the body its transform.
    Appearance->SetStringField(TEXT("description"), TEXT("not-an-object"));
    TestTrue(TEXT("malformed traits degrade to no traits"), FTVHumanoidVisualState::Parse(J, State, Error));
    TestFalse(TEXT("malformed traits are not presented"), State.Appearance.Description.bHasDescription);
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
