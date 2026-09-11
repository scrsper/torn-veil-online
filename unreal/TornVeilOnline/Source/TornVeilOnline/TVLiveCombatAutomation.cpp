#include "TVLiveCombat.h"
#include "TVInteractionSpec.generated.h"

#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "Dom/JsonObject.h"
#include "TVBridgeSubsystem.h"
#include "Engine/World.h"

namespace {
FTVMovementState CombatState(double X = 0, double Y = 0, double Z = 0) {
    FTVMovementState S; S.Position = FVector(X, Y, Z); S.Yaw = 0; S.Speed = 2; S.bEligible = true; return S;
}
TOptional<FTVPredictionColumn> FlatColumn(int32, int32) {
    FTVPredictionColumn C; C.Floor = 0; C.bWalkable = true; return C;
}
FTVMovementState AdvanceDefense(const FTVLiveCombat& Action, FTVMovementState State, int32 Frames,
    TFunctionRef<TOptional<FTVPredictionColumn>(int32, int32)> Column) {
    for (int32 I = 0; I < Frames; ++I) State = Action.Step(State, I / 60.0, 1.0 / 60.0, Column);
    return State;
}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVLiveCombatPrediction,
    "TornVeil.Realtime.LiveCombat.Prediction", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVLiveCombatPrediction::RunTest(const FString&) {
    const auto Attack = FTVLiveCombat::Predict(TEXT("attack"), 0, 1, TEXT("cmd-attack"));
    TestTrue(TEXT("predicted attack is valid"), Attack.IsValid() && Attack.IsAttack());
    TestTrue(TEXT("predicted attack starts in preparation"), Attack.Phase == TEXT("preparation") && Attack.Outcome == TEXT("pending"));
    TestEqual(TEXT("predicted attack retains command identity"), Attack.Id, FString(TEXT("cmd-attack")));
    TestTrue(TEXT("attack has a real active interval before recovery"), Attack.ActiveAt < Attack.RecoveryAt && Attack.RecoveryAt < Attack.CompleteAt);
    const auto Baseline = CombatState(2, 1, 3);
    const auto AttackStep = Attack.Step(Baseline, .1, 1.0 / 60.0, FlatColumn);
    TestTrue(TEXT("attack prediction does not mutate movement state"), AttackStep.Position.Equals(Baseline.Position) && FMath::IsNearlyEqual(AttackStep.Yaw, Baseline.Yaw));

    const auto Left = FTVLiveCombat::Predict(TEXT("sidestep"), 0, -1, TEXT("cmd-left"));
    const auto Right = FTVLiveCombat::Predict(TEXT("sidestep"), 0, 1, TEXT("cmd-right"));
    TestTrue(TEXT("left and right sidesteps mirror direction"), Left.Direction.X < 0 && Right.Direction.X > 0 && FMath::IsNearlyEqual(Left.Direction.Size(), Right.Direction.Size()));
    TestNearlyEqual(TEXT("sidestep uses shared configured distance"), Right.Distance, TVInteractionSpec::sidestepMetres, .0001);
    TestNearlyEqual(TEXT("backstep uses shared configured distance"), FTVLiveCombat::Predict(TEXT("backstep"), 0, 1, TEXT("cmd-back")).Distance, TVInteractionSpec::backstepMetres, .0001);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVLiveCombatDefenseSweep,
    "TornVeil.Realtime.LiveCombat.DefenseSweep", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVLiveCombatDefenseSweep::RunTest(const FString&) {
    const auto Action = FTVLiveCombat::Predict(TEXT("sidestep"), 0, 1, TEXT("cmd-sweep"));
    const auto Clear = AdvanceDefense(Action, CombatState(), 30, FlatColumn);
    TestTrue(TEXT("sidestep moves during its permitted defense window"), Clear.Position.X > .9 && Clear.Position.X < 1.1);
    TestNearlyEqual(TEXT("sidestep preserves facing"), Clear.Yaw, 0, .0001);

    const auto BlockedColumn = [](int32 X, int32 Z) -> TOptional<FTVPredictionColumn> {
        FTVPredictionColumn C; C.Floor = 0; C.bWalkable = true;
        if (X >= 1) C.Solids.Add(0);
        return C;
    };
    const auto Blocked = AdvanceDefense(Action, CombatState(), 30, BlockedColumn);
    TestTrue(TEXT("defense sweep respects canonical collision"), Blocked.Position.X < .9);
    TestTrue(TEXT("blocked defense does not tunnel through the obstacle"), Blocked.Position.X >= -.01);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVLiveCombatPostureGeometry,
    "TornVeil.Realtime.LiveCombat.PostureGeometry", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVLiveCombatPostureGeometry::RunTest(const FString&) {
    auto High = FTVLiveCombat::Predict(TEXT("attack"), 0, 1, TEXT("cmd-high"));
    auto Low = FTVLiveCombat::Predict(TEXT("attack"), 0, 1, TEXT("cmd-low"));
    High.Trajectory = TEXT("high"); Low.Trajectory = TEXT("low");
    const FVector HighPoint = High.StrikePoint(.375), LowPoint = Low.StrikePoint(.375);
    TestTrue(TEXT("high trajectory uses upper contact geometry"), HighPoint.Y > 1.4);
    TestTrue(TEXT("low trajectory uses lower contact geometry"), LowPoint.Y < .6);
    TestTrue(TEXT("trajectory changes only strike geometry"), FMath::IsNearlyEqual(HighPoint.X, LowPoint.X) && FMath::IsNearlyEqual(HighPoint.Z, LowPoint.Z));

    auto Duck = FTVLiveCombat::Predict(TEXT("duck"), 0, 1, TEXT("cmd-duck"));
    TestTrue(TEXT("duck reaches a nonzero low posture while running"), Duck.Duck(.10) > .5);
    TestNearlyEqual(TEXT("duck returns to standing after completion"), static_cast<double>(Duck.Duck(Duck.CompleteAt - Duck.StartedAt + .01)), 0.0, .0001);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVLiveCombatPlanAndBinding,
    "TornVeil.Realtime.LiveCombat.PlanAndBinding", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVLiveCombatPlanAndBinding::RunTest(const FString&) {
    auto Action = FTVLiveCombat::Predict(TEXT("attack"), .4, 1, TEXT("cmd-stable"));
    Action.ActorBodyId = TEXT("body-a");
    const auto Plan = Action.Plan(0);
    TestTrue(TEXT("live plan has a bounded duration"), Plan.Duration > 0 && Plan.Duration < 3);
    TestNearlyEqual(TEXT("live plan uses canonical contact timing"), static_cast<double>(Plan.ContactAt), Action.RecoveryAt - Action.StartedAt, .0001);
    TestNearlyEqual(TEXT("live plan does not align mesh to target"), static_cast<double>(Plan.AlignmentYaw), 0.0, .0001);
    TestTrue(TEXT("live plan carries no target warp offset"), Plan.ContactOffset.IsNearlyZero());

    auto SameCommand = Action;
    SameCommand.Phase = TEXT("active"); SameCommand.Outcome = TEXT("pending");
    TestEqual(TEXT("confirmation keeps stable action id"), SameCommand.Id, Action.Id);
    TestEqual(TEXT("confirmation keeps stable command id"), SameCommand.CommandId, Action.CommandId);
    TestTrue(TEXT("confirmed action remains running during active phase"), SameCommand.Running(.35));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVLiveCombatParse,
    "TornVeil.Realtime.LiveCombat.Parse", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVLiveCombatParse::RunTest(const FString&) {
    auto J = MakeShared<FJsonObject>();
    J->SetStringField(TEXT("id"), TEXT("action-1")); J->SetStringField(TEXT("kind"), TEXT("attack"));
    J->SetNumberField(TEXT("startedAt"), 10); J->SetNumberField(TEXT("activeAt"), 10.3);
    J->SetNumberField(TEXT("recoveryAt"), 10.45); J->SetNumberField(TEXT("completeAt"), 10.75);
    FTVLiveCombat Parsed;
    TestTrue(TEXT("canonical live action parses"), FTVLiveCombat::Parse(J, Parsed));
    TestEqual(TEXT("parsed action identity is preserved"), Parsed.Id, FString(TEXT("action-1")));
    J->SetNumberField(TEXT("completeAt"), 14);
    TestFalse(TEXT("overlong live action is rejected"), FTVLiveCombat::Parse(J, Parsed));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVLiveCombatReconciliation,
    "TornVeil.Realtime.LiveCombat.BlockedReconciliation", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVLiveCombatReconciliation::RunTest(const FString&) {
    // The client has an old open-space collision window. Authority supplies the newly blocked
    // result through the actual owning-client reconciliation path, with all inputs acknowledged.
    auto* TestWorld = NewObject<UWorld>();
    auto* Bridge = NewObject<UTVBridgeSubsystem>(TestWorld);
    const auto Action = FTVLiveCombat::Predict(TEXT("backstep"), 0, 1, TEXT("dodge-command"));
    const auto Start = CombatState(0, 0, .65);
    const auto Wall = [](int32, int32 Z) -> TOptional<FTVPredictionColumn> {
        FTVPredictionColumn C; C.Floor = 0; C.bWalkable = true; if (Z >= 1) C.Solids.Add(0); return C;
    };
    const auto Open = AdvanceDefense(Action, Start, 18, FlatColumn);
    const auto Blocked = AdvanceDefense(Action, Start, 18, Wall);
    Bridge->InteractionEpoch = TEXT("test-epoch"); Bridge->InteractionBody = TEXT("body-a");
    Bridge->bPredictionReady = true; Bridge->Predicted = Open; Bridge->PredictedCombat = Action;
    Bridge->GeometrySize = 4; Bridge->GeometryX = -1; Bridge->GeometryZ = -1;
    for (int32 I=0; I<16; ++I) Bridge->PredictionColumns.Add(FlatColumn(0,0).GetValue());
    Bridge->CombatCommandSequence = 1;
    for (int32 I = 2; I <= 19; ++I) Bridge->PendingMovement.Add({I, {0,0,false}, Action, (I-2)/60.0});
    Bridge->PresentedContacts.Add(TEXT("existing-contact"));
    auto Message = MakeShared<FJsonObject>();
    Message->SetStringField(TEXT("epoch"), TEXT("test-epoch")); Message->SetStringField(TEXT("bodyId"), TEXT("body-a"));
    Message->SetNumberField(TEXT("tick"), .3); Message->SetNumberField(TEXT("ack"), 19);
    auto State = MakeShared<FJsonObject>(), Position = MakeShared<FJsonObject>();
    Position->SetNumberField(TEXT("x"), Blocked.Position.X); Position->SetNumberField(TEXT("y"), Blocked.Position.Y); Position->SetNumberField(TEXT("z"), Blocked.Position.Z);
    State->SetObjectField(TEXT("pos"), Position); State->SetNumberField(TEXT("yaw"),0); State->SetNumberField(TEXT("speed"),2); State->SetBoolField(TEXT("eligible"),true);
    Message->SetObjectField(TEXT("state"), State);
    auto CanonicalAction = MakeShared<FJsonObject>();
    CanonicalAction->SetStringField(TEXT("id"),TEXT("authority-action")); CanonicalAction->SetStringField(TEXT("commandId"),TEXT("dodge-command"));
    CanonicalAction->SetStringField(TEXT("actorBodyId"),TEXT("body-a")); CanonicalAction->SetStringField(TEXT("kind"),TEXT("backstep"));
    CanonicalAction->SetStringField(TEXT("phase"),TEXT("recovery")); CanonicalAction->SetStringField(TEXT("outcome"),TEXT("pending"));
    CanonicalAction->SetNumberField(TEXT("startedAt"),0); CanonicalAction->SetNumberField(TEXT("activeAt"),0);
    CanonicalAction->SetNumberField(TEXT("recoveryAt"),.3); CanonicalAction->SetNumberField(TEXT("completeAt"),.6);
    Message->SetObjectField(TEXT("combatAction"),CanonicalAction);
    Bridge->ReceiveLocalState(Message);
    TestTrue(TEXT("blocked authority corrects stale open backstep by about eighty centimetres"),Bridge->CorrectionCm>75&&Bridge->CorrectionCm<85);
    TestTrue(TEXT("corrected position equals authority"),Bridge->Predicted.Position.Equals(Blocked.Position,.0001));
    TestEqual(TEXT("all acknowledged replay inputs are removed"),Bridge->PendingMovement.Num(),0);
    TestEqual(TEXT("command binds to authoritative identity"),Bridge->PredictedCombat.Id,FString(TEXT("authority-action")));
    TestTrue(TEXT("large correction is immediate rather than leaving a body across the wall"),Bridge->RenderCorrection.IsNearlyZero());
    TestTrue(TEXT("correction CPU duration is recorded"),Bridge->CombatCorrectionTimeSamples.Num()==1&&FMath::IsFinite(Bridge->CombatCorrectionTimeSamples[0]));
    AddInfo(FString::Printf(TEXT("Blocked correction %.3f cm, CPU %.6f ms, render correction immediate"),Bridge->CorrectionCm,Bridge->CombatCorrectionTimeSamples[0]));
    Bridge->ReceiveLocalState(Message);
    TestNearlyEqual(TEXT("duplicate authority does not repeat displacement"),Bridge->CorrectionCm,0.,.0001);
    TestEqual(TEXT("reconciliation does not replay contact effects"),Bridge->PresentedContacts.Num(),1);
    return true;
}
#endif
