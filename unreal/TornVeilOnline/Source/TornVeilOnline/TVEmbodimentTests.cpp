#include "TVEmbodiment.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "Dom/JsonObject.h"

namespace {
    TSharedPtr<FJsonObject> MakeSlot(const TCHAR* Kind, const TCHAR* Token, bool bTint = false, int32 Tint = 0) {
        auto Slot = MakeShared<FJsonObject>();
        Slot->SetStringField(TEXT("kind"), Kind);
        Slot->SetStringField(TEXT("token"), Token);
        if (bTint) Slot->SetNumberField(TEXT("tint"), Tint);
        return Slot;
    }
    TSharedPtr<FJsonObject> MakeProfile() {
        auto Profile = MakeShared<FJsonObject>();
        Profile->SetStringField(TEXT("personId"), TEXT("p_128"));
        Profile->SetStringField(TEXT("bodyId"), TEXT("b_141"));
        Profile->SetStringField(TEXT("signature"), TEXT("k3f9z"));
        Profile->SetStringField(TEXT("species"), TEXT("human"));
        Profile->SetStringField(TEXT("sex"), TEXT("male"));
        Profile->SetStringField(TEXT("lifeStage"), TEXT("adult"));
        Profile->SetNumberField(TEXT("height"), 1.02);
        Profile->SetNumberField(TEXT("build"), 0.97);
        Profile->SetBoolField(TEXT("authored"), false);
        TArray<TSharedPtr<FJsonValue>> Slots;
        Slots.Add(MakeShared<FJsonValueObject>(MakeSlot(TEXT("body"), TEXT("body_human_adult_m"))));
        Slots.Add(MakeShared<FJsonValueObject>(MakeSlot(TEXT("torso"), TEXT("apron_smith"), true, 0x8a6a4a)));
        Slots.Add(MakeShared<FJsonValueObject>(MakeSlot(TEXT("feet"), TEXT("boots_work"))));
        Profile->SetArrayField(TEXT("slots"), Slots);
        return Profile;
    }
    TSharedPtr<FJsonObject> MakeActivity() {
        auto Activity = MakeShared<FJsonObject>();
        Activity->SetStringField(TEXT("family"), TEXT("work"));
        Activity->SetStringField(TEXT("detail"), TEXT("forge"));
        Activity->SetStringField(TEXT("posture"), TEXT("stand"));
        Activity->SetStringField(TEXT("locomotion"), TEXT("idle"));
        Activity->SetStringField(TEXT("station"), TEXT("work"));
        Activity->SetStringField(TEXT("placeId"), TEXT("pl_smithy"));
        Activity->SetNumberField(TEXT("speed"), 0.0);
        auto Injury = MakeShared<FJsonObject>();
        Injury->SetBoolField(TEXT("impaired"), true);
        Injury->SetNumberField(TEXT("severity"), 0.6);
        Injury->SetNumberField(TEXT("movementMultiplier"), 0.55);
        Activity->SetObjectField(TEXT("injury"), Injury);
        return Activity;
    }
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVAppearanceProfileParser,
    "TornVeil.Embodiment.AppearanceProfile", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVAppearanceProfileParser::RunTest(const FString&) {
    FTVAppearanceProfile Profile; FString Error;
    TestTrue(TEXT("a complete profile parses"), FTVAppearanceProfile::Parse(MakeProfile(), Profile, Error));
    TestEqual(TEXT("canonical person id survives the projection"), Profile.PersonId, FString(TEXT("p_128")));
    TestEqual(TEXT("canonical body id survives the projection"), Profile.BodyId, FString(TEXT("b_141")));
    TestEqual(TEXT("every well-formed slot is kept"), Profile.Slots.Num(), 3);
    TestTrue(TEXT("a tinted slot keeps its canonical colour"),
        Profile.FindSlot(TEXT("torso")) && Profile.FindSlot(TEXT("torso"))->bHasTint && Profile.FindSlot(TEXT("torso"))->Tint == 0x8a6a4a);
    TestFalse(TEXT("an untinted slot does not invent a colour"), Profile.FindSlot(TEXT("feet"))->bHasTint);

    // Identity and the signature are what make an appearance stable across a reload. A profile
    // missing either is rejected outright rather than resolved to a default person.
    for (const TCHAR* Field : {TEXT("personId"), TEXT("bodyId"), TEXT("signature")}) {
        TSharedPtr<FJsonObject> Broken = MakeProfile();
        Broken->SetStringField(Field, TEXT(""));
        FTVAppearanceProfile Rejected;
        TestFalse(FString::Printf(TEXT("empty %s is rejected"), Field), FTVAppearanceProfile::Parse(Broken, Rejected, Error));
    }
    TSharedPtr<FJsonObject> Slotless = MakeProfile();
    Slotless->SetArrayField(TEXT("slots"), TArray<TSharedPtr<FJsonValue>>());
    FTVAppearanceProfile Rejected;
    TestFalse(TEXT("a profile with no slots is rejected"), FTVAppearanceProfile::Parse(Slotless, Rejected, Error));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVActivityPresentationParser,
    "TornVeil.Embodiment.ActivityPresentation", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVActivityPresentationParser::RunTest(const FString&) {
    FTVActivityPresentation Activity; FString Error;
    TestTrue(TEXT("a work activity parses"), FTVActivityPresentation::Parse(MakeActivity(), Activity, Error));
    TestEqual(TEXT("family is preserved"), Activity.Family, FString(TEXT("work")));
    TestEqual(TEXT("detail is preserved"), Activity.Detail, FString(TEXT("forge")));
    TestEqual(TEXT("the required station is preserved"), Activity.Station, FString(TEXT("work")));
    TestTrue(TEXT("canonical injury consequence is exposed, not recomputed"),
        Activity.bImpaired && FMath::IsNearlyEqual(Activity.InjurySeverity, .6f) && FMath::IsNearlyEqual(Activity.MovementMultiplier, .55f));

    // A body with no wound must not arrive claiming one.
    TSharedPtr<FJsonObject> Healthy = MakeActivity();
    Healthy->RemoveField(TEXT("injury"));
    FTVActivityPresentation Sound;
    TestTrue(TEXT("an activity without an injury block parses"), FTVActivityPresentation::Parse(Healthy, Sound, Error));
    TestFalse(TEXT("absent injury data means uninjured"), Sound.bImpaired);
    TestTrue(TEXT("absent injury data means full canonical movement"), FMath::IsNearlyEqual(Sound.MovementMultiplier, 1.f));

    TSharedPtr<FJsonObject> Nameless = MakeActivity();
    Nameless->SetStringField(TEXT("family"), TEXT(""));
    FTVActivityPresentation Broken;
    TestFalse(TEXT("an activity with no family is rejected"), FTVActivityPresentation::Parse(Nameless, Broken, Error));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVEmbodimentStateParser,
    "TornVeil.Embodiment.State", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVEmbodimentStateParser::RunTest(const FString&) {
    auto Root = MakeShared<FJsonObject>();
    Root->SetStringField(TEXT("appearanceSignature"), TEXT("k3f9z"));
    Root->SetObjectField(TEXT("appearance"), MakeProfile());
    Root->SetObjectField(TEXT("activity"), MakeActivity());
    auto Station = MakeShared<FJsonObject>();
    Station->SetStringField(TEXT("slotId"), TEXT("pl_smithy:work:9,1,9:0,-1"));
    Station->SetStringField(TEXT("kind"), TEXT("work"));
    Station->SetStringField(TEXT("posture"), TEXT("stand"));
    auto Stand = MakeShared<FJsonObject>();
    Stand->SetNumberField(TEXT("x"), 9.5); Stand->SetNumberField(TEXT("y"), 1); Stand->SetNumberField(TEXT("z"), 8.5);
    Station->SetObjectField(TEXT("stand"), Stand);
    Station->SetNumberField(TEXT("yaw"), 0.0);
    Station->SetNumberField(TEXT("settleMetres"), 1.0);
    Root->SetObjectField(TEXT("station"), Station);
    auto Separation = MakeShared<FJsonObject>();
    Separation->SetNumberField(TEXT("x"), 0.1); Separation->SetNumberField(TEXT("z"), -0.2);
    Root->SetObjectField(TEXT("separation"), Separation);

    FTVEmbodimentState State; FString Error;
    TestTrue(TEXT("a full embodiment block parses"), FTVEmbodimentState::Parse(Root, State, Error));
    TestTrue(TEXT("the appearance arrives on the snapshot that carries it"), State.bHasAppearance);
    TestTrue(TEXT("the chosen station is valid"), State.Station.bValid);
    TestEqual(TEXT("the station keeps its canonical stand position"), State.Station.StandMetres, FVector(9.5, 1.0, 8.5));

    // The steady state: signature only, no profile. The renderer must keep the character it built.
    auto Steady = MakeShared<FJsonObject>();
    Steady->SetStringField(TEXT("appearanceSignature"), TEXT("k3f9z"));
    Steady->SetObjectField(TEXT("activity"), MakeActivity());
    FTVEmbodimentState Later;
    TestTrue(TEXT("a signature-only snapshot parses"), FTVEmbodimentState::Parse(Steady, Later, Error));
    TestFalse(TEXT("a signature-only snapshot carries no profile"), Later.bHasAppearance);
    TestEqual(TEXT("the signature still identifies the built character"), Later.AppearanceSignature, State.AppearanceSignature);
    TestFalse(TEXT("an absent station is not invented"), Later.Station.bValid);

    auto Activityless = MakeShared<FJsonObject>();
    Activityless->SetStringField(TEXT("appearanceSignature"), TEXT("k3f9z"));
    FTVEmbodimentState Broken;
    TestFalse(TEXT("embodiment without an activity is rejected"), FTVEmbodimentState::Parse(Activityless, Broken, Error));
    return true;
}
#endif
