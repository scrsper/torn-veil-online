#include "TVCombatChoreography.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include <limits>

namespace {
void Vec(const TSharedPtr<FJsonObject>& J, const TCHAR* Key, double X, double Y, double Z) {
    auto V = MakeShared<FJsonObject>(); V->SetNumberField(TEXT("x"), X); V->SetNumberField(TEXT("y"), Y); V->SetNumberField(TEXT("z"), Z); J->SetObjectField(Key, V);
}
TSharedPtr<FJsonObject> Event(int64 Seq = 1, const TCHAR* Outcome = TEXT("hit"), double Strength = .5, double Dexterity = .5, double Exertion = 1) {
    auto J = MakeShared<FJsonObject>();
    J->SetNumberField(TEXT("seq"), Seq); J->SetStringField(TEXT("eventId"), FString::Printf(TEXT("combat-%lld"), Seq));
    J->SetStringField(TEXT("actorBodyId"), TEXT("body-a")); J->SetStringField(TEXT("targetBodyId"), TEXT("body-b"));
    J->SetStringField(TEXT("action"), TEXT("strike")); J->SetStringField(TEXT("outcome"), Outcome); J->SetStringField(TEXT("weaponType"), TEXT("unarmed"));
    J->SetNumberField(TEXT("physicalTime"), Seq); J->SetNumberField(TEXT("actorYaw"), 0); J->SetNumberField(TEXT("attackSeq"), Seq); J->SetNumberField(TEXT("hitSeq"), Seq);
    Vec(J, TEXT("actorPosition"), 0, 0, 0); Vec(J, TEXT("targetPosition"), 1.5, 0, 0); Vec(J, TEXT("targetVelocity"), 0, 0, 0);
    auto C = MakeShared<FJsonObject>(); C->SetNumberField(TEXT("strength"), Strength); C->SetNumberField(TEXT("dexterity"), Dexterity); C->SetNumberField(TEXT("exertion"), Exertion); J->SetObjectField(TEXT("capability"), C);
    return J;
}
TSharedPtr<FJsonObject> Stream(int64 First, int64 Last, const TArray<TSharedPtr<FJsonValue>>& Rows) {
    auto J = MakeShared<FJsonObject>(); J->SetNumberField(TEXT("version"), 1); J->SetNumberField(TEXT("firstAvailableSeq"), First); J->SetNumberField(TEXT("latestSeq"), Last); J->SetArrayField(TEXT("events"), Rows); return J;
}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVCombatChoreographyParser,
    "TornVeil.Combat.Choreography.Parser", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVCombatChoreographyParser::RunTest(const FString&) {
    FTVCombatEvent E; auto J = Event();
    TestTrue(TEXT("valid strike parses"), FTVCombatEvent::Parse(J, E));
    J->SetStringField(TEXT("eventId"), FString::ChrN(129, TEXT('x'))); TestFalse(TEXT("overlong event id rejects"), FTVCombatEvent::Parse(J, E));
    J = Event(); J->SetStringField(TEXT("actorBodyId"), TEXT("")); TestFalse(TEXT("empty actor body id rejects"), FTVCombatEvent::Parse(J, E));
    J = Event(); J->SetStringField(TEXT("outcome"), TEXT("critical")); TestFalse(TEXT("unknown outcome rejects"), FTVCombatEvent::Parse(J, E));
    J = Event(); J->SetNumberField(TEXT("seq"), 1.5); TestFalse(TEXT("fractional sequence rejects"), FTVCombatEvent::Parse(J, E));
    J = Event(); J->SetNumberField(TEXT("seq"), std::numeric_limits<double>::quiet_NaN()); TestFalse(TEXT("nonfinite sequence rejects"), FTVCombatEvent::Parse(J, E));
    J = Event(); J->SetNumberField(TEXT("actorYaw"), std::numeric_limits<double>::infinity()); TestFalse(TEXT("nonfinite vector-adjacent scalar rejects"), FTVCombatEvent::Parse(J, E));
    J = Event(); Vec(J, TEXT("actorPosition"), std::numeric_limits<double>::quiet_NaN(), 0, 0); TestFalse(TEXT("nonfinite vector rejects"), FTVCombatEvent::Parse(J, E));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVCombatChoreographyPlan,
    "TornVeil.Combat.Choreography.Plan", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVCombatChoreographyPlan::RunTest(const FString&) {
    FTVCombatEvent E; FTVCombatEvent::Parse(Event(1, TEXT("hit"), .25, .25, 1), E);
    FTVChoreographyRequest R; R.Event = E; auto P = FTVCombatChoreographer::Plan(R);
    auto Strong = E; Strong.Strength = 1.8f; Strong.Dexterity = 1.8f; Strong.Exertion = .2f; auto PS = FTVCombatChoreographer::Plan({Strong, 0, 1, false});
    TestTrue(TEXT("true strength changes force"), PS.Style.Force != P.Style.Force); TestTrue(TEXT("true dexterity changes control"), PS.Style.Control != P.Style.Control); TestTrue(TEXT("exertion changes recovery economy"), PS.Style.Economy != P.Style.Economy || PS.Style.Recovery != P.Style.Recovery);
    auto Fixture = E; Fixture.bFixture = true; Fixture.bHasMastery = true; Fixture.Mastery = 1; auto PF = FTVCombatChoreographer::Plan({Fixture, 0, 1, false});
    TestTrue(TEXT("fixture mastery changes control"), PF.Style.Control > P.Style.Control);
    auto Child = E; Child.bFixture = true; Child.LineageId = TEXT("lineage-root"); Child.TechniqueId = TEXT("child-a"); auto C2 = Child; C2.Seq = 99; C2.TechniqueId = TEXT("child-b");
    TestEqual(TEXT("lineage keeps stable signature seed across sequence and child technique"), FTVTechniqueVisualSignature::From(Child).Seed, FTVTechniqueVisualSignature::From(C2).Seed);
    TestEqual(TEXT("lineage keeps stable motif across sequence and child technique"), FTVTechniqueVisualSignature::From(Child).Motif, FTVTechniqueVisualSignature::From(C2).Motif);
    auto T1 = Child; T1.TechniqueId = TEXT("primary"); T1.Seq = 10; auto T2 = T1; T2.Seq = 11; auto T3 = T1; T3.Seq = 12;
    auto PT1 = FTVCombatChoreographer::Plan({T1}); auto PT2 = FTVCombatChoreographer::Plan({T2}); auto PT3 = FTVCombatChoreographer::Plan({T3});
    TestTrue(TEXT("persistent technique keeps its primary primitive across events"), PT1.Motion.Id == PT2.Motion.Id && PT2.Motion.Id == PT3.Motion.Id);
    TestNearlyEqual(TEXT("same technique input has deterministic timing"), PT1.ContactAt, FTVCombatChoreographer::Plan({T1}).ContactAt, .0001f);
    TestTrue(TEXT("technique timing variation remains bounded"), FMath::Abs(PT1.ContactAt - PT2.ContactAt) <= .02f && FMath::Abs(PT2.ContactAt - PT3.ContactAt) <= .02f);
    TestTrue(TEXT("lineage child keeps primary primitive at equal capability"), PT1.Motion.Id == FTVCombatChoreographer::Plan({C2}).Motion.Id);
    TestTrue(TEXT("planner does not construct three-hit animation"), !P.Motion.Id.Contains(TEXT("3")) && !P.Motion.Id.Contains(TEXT("burst")) && !P.Motion.Id.Contains(TEXT("combo")));
    TestTrue(TEXT("offset stays within 22 cm"), P.Offset(P.ContactAt).Size2D() <= 22.001f);
    TestTrue(TEXT("offset returns to zero"), P.Offset(P.Duration + 1).IsNearlyZero()); TestNearlyEqual(TEXT("yaw returns to zero"), P.Yaw(P.Duration + 1), 0, .01f);
    auto Far = E; Far.TargetPosition = FVector(4, 0, 0); auto Side = E; Side.TargetPosition = FVector(1.5, 0, 2); auto PFar = FTVCombatChoreographer::Plan({Far}); auto PSide = FTVCombatChoreographer::Plan({Side});
    TestTrue(TEXT("target distance changes contact plan"), !FMath::IsNearlyEqual(PFar.ContactErrorCm, P.ContactErrorCm)); TestTrue(TEXT("target angle changes alignment"), !FMath::IsNearlyEqual(PSide.AlignmentYaw, P.AlignmentYaw));
    TestTrue(TEXT("target-aware lean is bounded"), PFar.LeanDegrees >= 0 && PFar.LeanDegrees <= 12 && FMath::Abs(PFar.Lean(PFar.ContactAt)) <= 12.001f);
    TestNearlyEqual(TEXT("lean returns to zero"), PFar.Lean(PFar.Duration + 1), 0.f, .01f);
    auto Low = FTVCombatChoreographer::Plan({E, 2, 1, false}); TestTrue(TEXT("LOD2 has no offset or trail"), Low.Offset(P.ContactAt).IsNearlyZero() && Low.FX.Trail == 0 && Low.FX.Impact == 0);

    // Target bearing must constrain primitive selection so a direct motion does not
    // exceed the planner's 55 degree alignment bound when a hook can fit instead.
    auto BearingEvent = E; BearingEvent.ActorYaw = -PI / 2.f;
    const auto MakeBearingEvent = [&](int64 Seq, float Distance, float Degrees) {
        auto B = BearingEvent; B.Seq = Seq;
        const float Radians = FMath::DegreesToRadians(Degrees);
        B.TargetPosition = FVector(Distance * FMath::Cos(Radians), 0, Distance * FMath::Sin(Radians));
        return B;
    };
    const auto PLeft = FTVCombatChoreographer::Plan({MakeBearingEvent(1, 1.1f, -30.f)});
    const auto PRight = FTVCombatChoreographer::Plan({MakeBearingEvent(2, 1.1f, 30.f)});
    TestTrue(TEXT("left 30 degree target remains within alignment bound"), FMath::Abs(PLeft.AlignmentYaw) <= 55.001f);
    TestTrue(TEXT("right 30 degree target remains within alignment bound"), FMath::Abs(PRight.AlignmentYaw) <= 55.001f);
    TestTrue(TEXT("left 1.1m target contact residual is below 2cm"), PLeft.ContactErrorCm < 2.f);
    TestTrue(TEXT("right 1.1m target contact residual is below 2cm"), PRight.ContactErrorCm < 2.f);
    const auto PNear = FTVCombatChoreographer::Plan({MakeBearingEvent(3, .8f, 0.f)});
    const auto PFarBearing = FTVCombatChoreographer::Plan({MakeBearingEvent(4, 1.4f, 0.f)});
    TestTrue(TEXT("near bearing target remains within alignment bound"), FMath::Abs(PNear.AlignmentYaw) <= 55.001f);
    TestTrue(TEXT("far bearing target remains within alignment bound"), FMath::Abs(PFarBearing.AlignmentYaw) <= 55.001f);
    TestTrue(TEXT("far bearing target reports quantified residual"), FMath::IsFinite(PFarBearing.ContactErrorCm) && PFarBearing.ContactErrorCm > 0.f);
    for (int64 Seq = 1; Seq <= 12; ++Seq) {
        for(float Degrees : {-30.f,30.f}) {
            const auto Input=MakeBearingEvent(Seq,1.1f,Degrees);
            const auto Planned=FTVCombatChoreographer::Plan({Input});
            const auto Repeated=FTVCombatChoreographer::Plan({Input});
            TestEqual(TEXT("identical event and target select same primitive"),Planned.Motion.Id,Repeated.Motion.Id);
            TestTrue(TEXT("every variation fits angled target"),Planned.ContactErrorCm<2 && FMath::Abs(Planned.AlignmentYaw)<=55.001f);
            TestTrue(TEXT("every variation keeps root bound"),Planned.Offset(Planned.ContactAt).Size()<=22.001f);
        }
    }
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVCombatChoreographyReplay,
    "TornVeil.Combat.Choreography.Replay", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVCombatChoreographyReplay::RunTest(const FString&) {
    FTVCombatReplayCursor Initial; TArray<TSharedPtr<FJsonValue>> InitialRows; auto OutOfWindow = Event(9); auto InitialBad = Event(2); InitialBad->SetStringField(TEXT("outcome"), TEXT("invalid")); InitialRows.Add(MakeShared<FJsonValueObject>(OutOfWindow)); InitialRows.Add(MakeShared<FJsonValueObject>(InitialBad));
    TestEqual(TEXT("initial baseline excludes malformed and out-of-window rows"), Initial.Read(Stream(1, 3, InitialRows)).Num(), 0); TestTrue(TEXT("initial baseline counts malformed rows"), Initial.Invalid >= 2);
    FTVCombatReplayCursor C; TArray<TSharedPtr<FJsonValue>> Empty;
    TestTrue(TEXT("first snapshot establishes cursor baseline"), C.Read(Stream(1, 3, Empty)).Num() == 0 && C.Latest == 3);
    TArray<TSharedPtr<FJsonValue>> Burst; Burst.Add(MakeShared<FJsonValueObject>(Event(4))); Burst.Add(MakeShared<FJsonValueObject>(Event(6))); Burst.Add(MakeShared<FJsonValueObject>(Event(5)));
    auto Got = C.Read(Stream(4, 6, Burst)); TestEqual(TEXT("burst is returned in sequence order"), Got.Num(), 3); TestTrue(TEXT("burst order is stable"), Got[0].Seq == 4 && Got[1].Seq == 5 && Got[2].Seq == 6);
    auto Dup = C.Read(Stream(4, 6, {MakeShared<FJsonValueObject>(Event(4))})); TestEqual(TEXT("duplicate event is suppressed"), Dup.Num(), 0); TestEqual(TEXT("duplicate count retained"), C.Duplicates, int64(1));
    TArray<TSharedPtr<FJsonValue>> Bad; Bad.Add(MakeShared<FJsonValueObject>(Event(7))); Bad.Add(MakeShared<FJsonValueObject>(Event(8))); Bad.Add(MakeShared<FJsonValueObject>(Event(9))); Bad[1]->AsObject()->SetStringField(TEXT("outcome"), TEXT("bad"));
    auto Retained = C.Read(Stream(8, 9, Bad)); TestEqual(TEXT("malformed row is rejected while valid row remains"), Retained.Num(), 1); TestTrue(TEXT("retention gap is measured"), C.RetentionGap >= 1); TestTrue(TEXT("invalid count is measured"), C.Invalid >= 1);
    auto Late = Event(7); Late->SetStringField(TEXT("eventId"), TEXT("late-reobserved-7")); TestEqual(TEXT("late event after retention is suppressed"), C.Read(Stream(7, 9, {MakeShared<FJsonValueObject>(Late)})).Num(), 0); TestTrue(TEXT("late suppression is counted"), C.Late >= 1);
    auto FractionalEnvelope = Stream(9, 9, TArray<TSharedPtr<FJsonValue>>()); FractionalEnvelope->SetNumberField(TEXT("firstAvailableSeq"), 9.5); TestEqual(TEXT("fractional first-available envelope is rejected"), C.Read(FractionalEnvelope).Num(), 0); FractionalEnvelope->SetNumberField(TEXT("firstAvailableSeq"), 9); FractionalEnvelope->SetNumberField(TEXT("latestSeq"), 9.5); TestEqual(TEXT("fractional latest envelope is rejected"), C.Read(FractionalEnvelope).Num(), 0);
    auto ReusedId = Event(10); ReusedId->SetStringField(TEXT("eventId"), TEXT("combat-9")); TestEqual(TEXT("retained event id reused under another sequence is rejected"), C.Read(Stream(10, 10, {MakeShared<FJsonValueObject>(ReusedId)})).Num(), 0);
    auto Accepted = Event(10); Accepted->SetStringField(TEXT("eventId"), TEXT("accepted-10")); TestEqual(TEXT("new sequence remains readable after identity rejection"), C.Read(Stream(10, 10, {MakeShared<FJsonValueObject>(Accepted)})).Num(), 1);
    auto ConflictingSeq = Event(10); ConflictingSeq->SetStringField(TEXT("eventId"), TEXT("conflict-10")); TestEqual(TEXT("conflicting same-sequence id is rejected"), C.Read(Stream(10, 10, {MakeShared<FJsonValueObject>(ConflictingSeq)})).Num(), 0); TestTrue(TEXT("conflicting same-sequence id increments invalid count"), C.Invalid >= 2);
    TArray<TSharedPtr<FJsonValue>> TooMany; for (int32 I=0; I<129; ++I) TooMany.Add(MakeShared<FJsonValueObject>(Event(10 + I))); TestEqual(TEXT("oversized stream is rejected"), C.Read(Stream(10, 138, TooMany)).Num(), 0);
    return true;
}
#endif
