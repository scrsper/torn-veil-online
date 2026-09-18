#include "TVEmbodiment.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "Dom/JsonObject.h"

namespace {
    TSharedPtr<FJsonObject> MakeSlot(const TCHAR* SlotName, const TCHAR* Package, const TCHAR* Name) {
        auto Slot = MakeShared<FJsonObject>();
        Slot->SetStringField(TEXT("slot"), SlotName);
        Slot->SetStringField(TEXT("package"), Package);
        Slot->SetStringField(TEXT("name"), Name);
        Slot->SetStringField(TEXT("assetClass"), TEXT("SkeletalMesh"));
        Slot->SetArrayField(TEXT("materialSlots"), TArray<TSharedPtr<FJsonValue>>());
        return Slot;
    }

    TSharedPtr<FJsonObject> MakeProfile() {
        auto Profile = MakeShared<FJsonObject>();
        Profile->SetStringField(TEXT("personId"), TEXT("p_128"));
        Profile->SetStringField(TEXT("bodyId"), TEXT("b_141"));
        Profile->SetStringField(TEXT("signature"), TEXT("k3f9z"));
        auto Description = MakeShared<FJsonObject>();
        Description->SetStringField(TEXT("archetype"), TEXT("kaito"));
        Description->SetStringField(TEXT("culture"), TEXT("ashford"));
        Profile->SetObjectField(TEXT("description"), Description);

        auto Realization = MakeShared<FJsonObject>();
        Realization->SetStringField(TEXT("entityId"), TEXT("p_128"));
        Realization->SetStringField(TEXT("skeleton"), TEXT("/Game/Characters/Mannequins/Meshes/SK_Mannequin"));
        Realization->SetBoolField(TEXT("complete"), true);
        auto Scale = MakeShared<FJsonObject>();
        Scale->SetNumberField(TEXT("height"), 1.02); Scale->SetNumberField(TEXT("build"), .97);
        Realization->SetObjectField(TEXT("scale"), Scale);
        auto Materials = MakeShared<FJsonObject>();
        Materials->SetNumberField(TEXT("skin"), 0xd9a988);
        Materials->SetNumberField(TEXT("hair"), 0x1a1512);
        Materials->SetNumberField(TEXT("garmentPrimary"), 0x8a6a4a);
        Materials->SetNumberField(TEXT("garmentSecondary"), 0x3a3a38);
        Materials->SetNumberField(TEXT("garmentAccent"), 0x7a6a4a);
        Materials->SetNumberField(TEXT("wear"), .3); Materials->SetNumberField(TEXT("grooming"), .8);
        Realization->SetObjectField(TEXT("materials"), Materials);
        auto Morphs = MakeShared<FJsonObject>(); Morphs->SetNumberField(TEXT("muscular"), .6);
        Realization->SetObjectField(TEXT("morphs"), Morphs);
        TArray<TSharedPtr<FJsonValue>> Slots;
        Slots.Add(MakeShared<FJsonValueObject>(MakeSlot(TEXT("body"), TEXT("/Game/Fixture/Body"), TEXT("Body"))));
        Slots.Add(MakeShared<FJsonValueObject>(MakeSlot(TEXT("upperGarment"), TEXT("/Game/Fixture/Tunic"), TEXT("Tunic"))));
        Realization->SetArrayField(TEXT("slots"), Slots);
        Realization->SetArrayField(TEXT("problems"), TArray<TSharedPtr<FJsonValue>>());
        Profile->SetObjectField(TEXT("realization"), Realization);
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
    TestTrue(TEXT("a canonical-description Foundry profile parses"), FTVAppearanceProfile::Parse(MakeProfile(), Profile, Error));
    TestEqual(TEXT("canonical person id survives"), Profile.PersonId, FString(TEXT("p_128")));
    TestEqual(TEXT("canonical body id survives"), Profile.BodyId, FString(TEXT("b_141")));
    TestEqual(TEXT("resolved Foundry slots survive"), Profile.Slots.Num(), 2);
    TestEqual(TEXT("the resolved body package survives"), Profile.FindSlot(TEXT("body"))->Package, FString(TEXT("/Game/Fixture/Body")));
    TestTrue(TEXT("Foundry completeness survives"), Profile.bComplete);
    TestTrue(TEXT("canonical scale survives"), FMath::IsNearlyEqual(Profile.Height, 1.02f) && FMath::IsNearlyEqual(Profile.Build, .97f));
    TestTrue(TEXT("canonical materials survive"), Profile.Materials.Skin == 0xd9a988 && FMath::IsNearlyEqual(Profile.Materials.Wear, .3f));
    TestTrue(TEXT("Foundry morphs survive"), Profile.Morphs.Contains(TEXT("muscular")));

    for (const TCHAR* Field : {TEXT("personId"), TEXT("bodyId"), TEXT("signature")}) {
        TSharedPtr<FJsonObject> Broken = MakeProfile();
        Broken->SetStringField(Field, TEXT(""));
        FTVAppearanceProfile Rejected;
        TestFalse(FString::Printf(TEXT("empty %s is rejected"), Field), FTVAppearanceProfile::Parse(Broken, Rejected, Error));
    }
    TSharedPtr<FJsonObject> Descriptionless = MakeProfile();
    Descriptionless->RemoveField(TEXT("description"));
    FTVAppearanceProfile RejectedDescription;
    TestFalse(TEXT("a profile without canonical description is rejected"), FTVAppearanceProfile::Parse(Descriptionless, RejectedDescription, Error));
    TSharedPtr<FJsonObject> Mismatched = MakeProfile();
    const TSharedPtr<FJsonObject>* Realization = nullptr;
    Mismatched->TryGetObjectField(TEXT("realization"), Realization);
    (*Realization)->SetStringField(TEXT("entityId"), TEXT("p_other"));
    FTVAppearanceProfile RejectedIdentity;
    TestFalse(TEXT("a mismatched Foundry identity is rejected"), FTVAppearanceProfile::Parse(Mismatched, RejectedIdentity, Error));
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
