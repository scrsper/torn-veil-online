#include "TVInteractionPrediction.h"

#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"

namespace {
FTVMovementState State(double X, double Y, double Z, double Speed = 2.0, bool Eligible = true) {
    FTVMovementState S; S.Position = FVector(X, Y, Z); S.Yaw = 0; S.Speed = Speed; S.bEligible = Eligible; return S;
}
FTVMovementInput Input(double X, double Z, bool Sprint = false) {
    FTVMovementInput I; I.X = X; I.Z = Z; I.bSprint = Sprint; return I;
}
TOptional<FTVPredictionColumn> Flat(int32, int32) {
    FTVPredictionColumn C; C.Floor = 0; C.bWalkable = true; return C;
}
template <typename TColumn>
FTVMovementState Advance(FTVMovementState S, const FTVMovementInput& I, int32 Frames, TColumn Column) {
    for (int32 N = 0; N < Frames; ++N) S = FTVInteractionPrediction::Step(S, I, 1.0 / 60.0, Column);
    return S;
}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVRealtimeMovementPrediction,
    "TornVeil.Realtime.MovementPrediction", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FTVRealtimeMovementPrediction::RunTest(const FString&) {
    FString TraceText; TestTrue(TEXT("shared movement trace fixture is readable"), FFileHelper::LoadFileToString(TraceText, *(FPaths::ProjectDir() / TEXT("../../docs/evidence/realtime/movement-traces.json"))));
    TSharedPtr<FJsonObject> TraceRoot; TestTrue(TEXT("shared movement trace fixture parses"), FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(TraceText), TraceRoot) && TraceRoot.IsValid());
    const TArray<TSharedPtr<FJsonValue>>* TraceCases = nullptr; TestTrue(TEXT("shared movement trace cases exist"), TraceRoot->TryGetArrayField(TEXT("cases"), TraceCases));
    TMap<FString, TSharedPtr<FJsonObject>> Cases;
    if (TraceCases) for (const auto& V : *TraceCases) if (auto C = V->AsObject()) Cases.Add(C->GetStringField(TEXT("name")), C);
    const auto TraceState = [&](const TCHAR* Name) {
        const auto C = Cases.FindRef(Name); const auto S = C->GetObjectField(TEXT("state")); const auto P = S->GetObjectField(TEXT("position"));
        return State(P->GetNumberField(TEXT("x")), P->GetNumberField(TEXT("y")), P->GetNumberField(TEXT("z")), S->GetNumberField(TEXT("speed")), S->GetBoolField(TEXT("eligible")));
    };
    const auto TraceInput = [&](const TCHAR* Name) { const auto C = Cases.FindRef(Name); const auto I = C->GetObjectField(TEXT("input")); return Input(I->GetNumberField(TEXT("x")), I->GetNumberField(TEXT("z")), I->GetBoolField(TEXT("sprint"))); };
    for(const auto& Pair:Cases) {
        const auto Trace=Pair.Value,Expected=Trace->GetObjectField(TEXT("expect"));
        auto Actual=TraceState(*Pair.Key);const auto Movement=TraceInput(*Pair.Key);
        auto Columns=[Trace](int32 X,int32 Z)->TOptional<FTVPredictionColumn> {
            const TSharedPtr<FJsonObject>* All=nullptr;const TSharedPtr<FJsonObject>* Override=nullptr;
            if(!Trace->TryGetObjectField(TEXT("columns"),All)||!All||!(*All)->TryGetObjectField(FString::Printf(TEXT("%d,%d"),X,Z),Override)||!Override)return Flat(X,Z);
            FTVPredictionColumn Column;Column.Floor=(*Override)->GetNumberField(TEXT("floor"));Column.bWalkable=(*Override)->GetBoolField(TEXT("walkable"));
            for(const auto& Value:(*Override)->GetArrayField(TEXT("solids")))Column.Solids.Add(static_cast<int32>(Value->AsNumber()));
            return Column;
        };
        for(int32 Frame=0;Frame<Trace->GetIntegerField(TEXT("frames"));Frame++)Actual=FTVInteractionPrediction::Step(Actual,Movement,Trace->GetNumberField(TEXT("dt")),Columns);
        TestNearlyEqual(*(Pair.Key+TEXT(".x")),Actual.Position.X,Expected->GetNumberField(TEXT("x")),.00001);
        TestNearlyEqual(*(Pair.Key+TEXT(".y")),Actual.Position.Y,Expected->GetNumberField(TEXT("y")),.00001);
        TestNearlyEqual(*(Pair.Key+TEXT(".z")),Actual.Position.Z,Expected->GetNumberField(TEXT("z")),.00001);
        TestNearlyEqual(*(Pair.Key+TEXT(".yaw")),Actual.Yaw,Expected->GetNumberField(TEXT("yaw")),.00001);
    }
    const auto Diagonal = Advance(State(0, 0, 0), Input(1, 1), 30, Flat);
    const auto DiagonalTrace = Advance(TraceState(TEXT("diagonal-normalized")), TraceInput(TEXT("diagonal-normalized")), 30, Flat);
    const auto DExpected = Cases.FindRef(TEXT("diagonal-normalized"))->GetObjectField(TEXT("expect"));
    TestNearlyEqual(TEXT("diagonal X is normalized"), Diagonal.Position.X, DExpected->GetNumberField(TEXT("x")), .0001);
    TestNearlyEqual(TEXT("diagonal Z is normalized"), Diagonal.Position.Z, DExpected->GetNumberField(TEXT("z")), .0001);
    TestNearlyEqual(TEXT("native consumes diagonal trace"), DiagonalTrace.Position.X, DExpected->GetNumberField(TEXT("x")), .0001);
    const auto Sprint = Advance(TraceState(TEXT("sprint")), TraceInput(TEXT("sprint")), 30, Flat);
    TestNearlyEqual(TEXT("sprint uses shared multiplier"), Sprint.Position.X, Cases.FindRef(TEXT("sprint"))->GetObjectField(TEXT("expect"))->GetNumberField(TEXT("x")), .0001);
    TestTrue(TEXT("yaw follows X then Z movement"), FMath::IsNearlyEqual(Sprint.Yaw, -PI / 2.0, .0001));

    // A one-cell-high solid wall blocks the capsule while the surrounding columns remain flat.
    auto Wall = [](int32 X, int32 Z) -> TOptional<FTVPredictionColumn> {
        FTVPredictionColumn C; C.Floor = 0; C.bWalkable = true;
        if (X == 2 && Z == 1) C.Solids.Add(1);
        return C;
    };
    const auto Blocked = Advance(State(1.2, 0, 1.5), Input(1, 0), 60, Wall);
    TestTrue(TEXT("solid wall prevents crossing"), Blocked.Position.X < 2.0);

    auto Stair = [](int32 X, int32 Z) -> TOptional<FTVPredictionColumn> {
        FTVPredictionColumn C; C.Floor = X >= 2 ? 1 : 0; C.bWalkable = true; return C;
    };
    const auto Climbed = Advance(State(1.2, 0, 1.5), Input(1, 0), 30, Stair);
    TestTrue(TEXT("walkable stair changes floor"), Climbed.Position.X > 1.2 && Climbed.Position.Y == 1);

    const auto Whole = Advance(State(0, 0, 0), Input(1, 1), 60, Flat);
    auto Half = Advance(State(0, 0, 0), Input(1, 1), 30, Flat);
    Half = Advance(Half, Input(1, 1), 30, Flat);
    TestNearlyEqual(TEXT("frame partition preserves X"), Half.Position.X, Whole.Position.X, .0001);
    TestNearlyEqual(TEXT("frame partition preserves Z"), Half.Position.Z, Whole.Position.Z, .0001);
    return true;
}
#endif
