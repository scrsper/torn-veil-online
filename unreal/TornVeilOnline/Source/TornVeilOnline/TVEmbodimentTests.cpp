#include "TVEmbodiment.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "Dom/JsonObject.h"
#include "TVCharacter.h"
#include "Engine/World.h"

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

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVCharacterScaleOwnership,
    "TornVeil.Embodiment.CharacterScaleOwnership", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVCharacterScaleOwnership::RunTest(const FString&) {
    UWorld* World = UWorld::CreateWorld(EWorldType::Game, false);
    ATVCharacter* Actor = World->SpawnActor<ATVCharacter>();
    UTVCharacterPresentation* Visible = Actor->FindComponentByClass<UTVCharacterPresentation>();
    Visible->BindDriver(Actor->GetMesh());
    auto Snapshot = MakeShared<FJsonObject>();
    Snapshot->SetStringField(TEXT("bodyId"), TEXT("b_141"));
    Snapshot->SetStringField(TEXT("entityId"), TEXT("p_128"));
    Snapshot->SetStringField(TEXT("name"), TEXT("Scale test"));
    Snapshot->SetStringField(TEXT("activity"), TEXT("idle"));
    Snapshot->SetStringField(TEXT("pose"), TEXT("stand"));
    Snapshot->SetNumberField(TEXT("yaw"), 0);
    for (const TCHAR* Key : {TEXT("pos"), TEXT("velocity")}) {
        auto V = MakeShared<FJsonObject>();
        V->SetNumberField(TEXT("x"), 0); V->SetNumberField(TEXT("y"), 0); V->SetNumberField(TEXT("z"), 0);
        Snapshot->SetObjectField(Key, V);
    }
    auto Legacy = MakeShared<FJsonObject>(); Snapshot->SetObjectField(TEXT("appearance"), Legacy);
    auto Embodiment = MakeShared<FJsonObject>(); Snapshot->SetObjectField(TEXT("embodiment"), Embodiment);
    Embodiment->SetObjectField(TEXT("activity"), MakeActivity());
    int32 Sample = 0;
    for (const FVector Expected : {FVector(.82, .82, .82), FVector(1), FVector(1.18, 1.18, 1.16), FVector(.7, .7, .55)}) {
        auto Profile = MakeProfile();
        Profile->SetStringField(TEXT("signature"), FString::Printf(TEXT("scale-%d"), Sample++));
        auto Realization = Profile->GetObjectField(TEXT("realization"));
        auto Scale = Realization->GetObjectField(TEXT("scale"));
        Scale->SetNumberField(TEXT("build"), Expected.X); Scale->SetNumberField(TEXT("height"), Expected.Z);
        const TCHAR* Mesh = TEXT("/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple");
        Realization->SetArrayField(TEXT("slots"), {
            MakeShared<FJsonValueObject>(MakeSlot(TEXT("body"), Mesh, TEXT("SKM_Manny_Simple"))),
            MakeShared<FJsonValueObject>(MakeSlot(TEXT("upperGarment"), Mesh, TEXT("SKM_Manny_Simple")))});
        Legacy->SetNumberField(TEXT("build"), Expected.X); Legacy->SetNumberField(TEXT("height"), Expected.Z);
        Embodiment->SetObjectField(TEXT("appearance"), Profile);
        Actor->Project(Snapshot, true);
        TestTrue(TEXT("installed body resolves"), Visible->HasVisibleCharacter());
        TestTrue(TEXT("driver remains unscaled behind Foundry"), Actor->GetMesh()->GetRelativeScale3D().Equals(FVector::OneVector));
        TestTrue(TEXT("visible world scale equals requested scale once"), Visible->GetComponentScale().Equals(TVPresentationScale(Expected.X, Expected.Z), 1.e-5));
        for (USceneComponent* Part : Visible->GetAttachChildren()) {
            TestTrue(TEXT("modular parts inherit the same single scale"), Part->GetComponentScale().Equals(TVPresentationScale(Expected.X, Expected.Z), 1.e-5));
        }
        // Ordinary snapshots omit unchanged Foundry profiles but still include legacy appearance.
        Embodiment->RemoveField(TEXT("appearance"));
        Actor->Project(Snapshot, false);
        TestTrue(TEXT("appearance delta never compounds or clamps Foundry scale"), Visible->GetComponentScale().Equals(TVPresentationScale(Expected.X, Expected.Z), 1.e-5));
        UE_LOG(LogTemp, Display, TEXT("TV_SCALE_VERIFIED requested=%s driver=%s visible=%s"),
            *Expected.ToString(), *Actor->GetMesh()->GetComponentScale().ToString(), *Visible->GetComponentScale().ToString());
        Profile->SetStringField(TEXT("signature"), FString::Printf(TEXT("fallback-%d"), Sample));
        Realization->SetBoolField(TEXT("complete"), false);
        Embodiment->SetObjectField(TEXT("appearance"), Profile);
        Actor->Project(Snapshot, false);
        TestFalse(TEXT("incomplete profile returns to fallback"), Visible->HasVisibleCharacter());
        const FVector Fallback(FMath::Clamp(Expected.X, .82, 1.18), FMath::Clamp(Expected.Y, .82, 1.18), FMath::Clamp(Expected.Z, .82, 1.16));
        TestTrue(TEXT("fallback driver owns legacy scale exactly once"), Actor->GetMesh()->GetComponentScale().Equals(TVPresentationScale(Fallback.X, Fallback.Z), 1.e-5));
    }
    World->DestroyWorld(false);
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
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVPresentationScaleProportions,
    "TornVeil.Embodiment.PresentationScaleKeepsProportions",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::ClientContext | EAutomationTestFlags::EngineFilter)
bool FTVPresentationScaleProportions::RunTest(const FString&) {
    // Adults keep their measured variation (heights/builds from the live capture).
    TestTrue(TEXT("average adult unchanged"), TVPresentationScale(1.f, 1.f).Equals(FVector(1, 1, 1), 1e-4));
    TestTrue(TEXT("slightly broad adult unchanged"), TVPresentationScale(1.f, .96f).Equals(FVector(1, 1, .96f), 1e-4));
    TestTrue(TEXT("slim adult unchanged"), TVPresentationScale(.93f, 1.f).Equals(FVector(.93f, .93f, 1), 1e-4));
    // Children keep their stature but are not squashed: a toddler 0.41 tall is not 0.56 wide.
    const FVector Toddler = TVPresentationScale(.56f, .41f);
    TestEqual(TEXT("toddler stature preserved"), Toddler.Z, .41, 1e-4);
    TestTrue(TEXT("toddler width within 8% of stature"), Toddler.X <= .41f * 1.08f + 1e-4 && Toddler.X >= .41f * .9f - 1e-4);
    const FVector Boy = TVPresentationScale(.9157f, .7433f);
    TestTrue(TEXT("11-year-old from the capture no longer 24% wider than tall"), Boy.X / Boy.Z <= 1.0801f);
    TestTrue(TEXT("uniform lateral scale"), FMath::IsNearlyEqual(Boy.X, Boy.Y));
    // Garbage in does not collapse or explode the body.
    TestTrue(TEXT("invalid values fall back to unit"), TVPresentationScale(NAN, -1.f).Equals(FVector(1, 1, 1), 1e-4));
    return true;
}
#endif
