#include "TVHumanoidVisualState.h"
#include "Dom/JsonObject.h"

namespace {
bool Number(const TSharedPtr<FJsonObject>& J, const TCHAR* Key, double& Out) {
    return J.IsValid() && J->TryGetNumberField(Key, Out) && FMath::IsFinite(Out);
}
bool RequiredString(const TSharedPtr<FJsonObject>& J, const TCHAR* Key, FString& Out, FString& Error) {
    if (!J.IsValid() || !J->TryGetStringField(Key, Out) || Out.IsEmpty()) {
        Error = FString::Printf(TEXT("humanoid visual state requires non-empty '%s'"), Key);
        return false;
    }
    return true;
}
bool RequiredVector(const TSharedPtr<FJsonObject>& J, const TCHAR* Key, FVector& Out, FString& Error) {
    const TSharedPtr<FJsonObject>* O = nullptr;
    double X = 0, Y = 0, Z = 0;
    if (!J.IsValid() || !J->TryGetObjectField(Key, O) || !O || !O->IsValid() ||
        !Number(*O, TEXT("x"), X) || !Number(*O, TEXT("y"), Y) || !Number(*O, TEXT("z"), Z) ||
        FMath::Abs(X) > 1.e12 || FMath::Abs(Y) > 1.e12 || FMath::Abs(Z) > 1.e12) {
        Error = FString::Printf(TEXT("humanoid visual state requires finite '%s.{x,y,z}'"), Key);
        return false;
    }
    Out = FVector(X, Y, Z);
    return true;
}
}

bool FTVHumanoidVisualState::Parse(const TSharedPtr<FJsonObject>& J, FTVHumanoidVisualState& Out, FString& Error) {
    Out = FTVHumanoidVisualState();
    Error.Empty();
    if (!RequiredString(J, TEXT("bodyId"), Out.BodyId, Error) ||
        !RequiredString(J, TEXT("entityId"), Out.EntityId, Error) ||
        !RequiredString(J, TEXT("name"), Out.Name, Error) ||
        !RequiredString(J, TEXT("activity"), Out.Activity, Error) ||
        !RequiredString(J, TEXT("pose"), Out.Pose, Error) ||
        !RequiredVector(J, TEXT("pos"), Out.Position, Error) ||
        !RequiredVector(J, TEXT("velocity"), Out.Velocity, Error)) return false;

    double N = 0;
    if (!Number(J, TEXT("yaw"), N)) { Error = TEXT("humanoid visual state requires finite 'yaw'"); return false; }
    Out.Yaw = static_cast<float>(FMath::Fmod(N, 2.0 * PI));
    if (Number(J, TEXT("speed"), N) && N >= 0 && N <= 1.e12) Out.Speed = static_cast<float>(N);
    if (Number(J, TEXT("lastAttackAt"), N)) Out.LastAttackAt = N;
    if (Number(J, TEXT("lastHitAt"), N)) Out.LastHitAt = N;
    auto Sequence = [](double Value) { return Value >= 0 && Value <= 9007199254740991.0 && Value == FMath::FloorToDouble(Value); };
    if (Number(J, TEXT("attackSeq"), N) && Sequence(N)) Out.AttackSeq = static_cast<int64>(N);
    if (Number(J, TEXT("hitSeq"), N) && Sequence(N)) Out.HitSeq = static_cast<int64>(N);
    J->TryGetBoolField(TEXT("dead"), Out.bDead);
    J->TryGetBoolField(TEXT("incapacitated"), Out.bIncapacitated);
    Out.bDead |= Out.Pose == TEXT("dead");
    Out.bIncapacitated |= Out.bDead || Out.Pose == TEXT("downed");
    const TSharedPtr<FJsonObject>* A = nullptr;
    if (J->TryGetObjectField(TEXT("appearance"), A) && A && A->IsValid()) {
        Out.Appearance.bPresent = true;
        double C = 0;
        if (Number(*A, TEXT("skin"), C) && C >= 0 && C <= 16777215) Out.Appearance.Skin = static_cast<uint32>(C);
        if (Number(*A, TEXT("shirt"), C) && C >= 0 && C <= 16777215) Out.Appearance.Shirt = static_cast<uint32>(C);
        if (Number(*A, TEXT("hair"), C) && C >= 0 && C <= 16777215) Out.Appearance.Hair = static_cast<uint32>(C);
        if (Number(*A, TEXT("height"), C)) Out.Appearance.Height = FMath::Clamp(static_cast<float>(C), .82f, 1.16f);
        if (Number(*A, TEXT("build"), C)) Out.Appearance.Build = FMath::Clamp(static_cast<float>(C), .82f, 1.18f);
        (*A)->TryGetStringField(TEXT("hatStyle"), Out.Appearance.HatStyle);
    }
    return true;
}

int32 FTVHumanoidVisualState::PendingDelta(int64 Previous, int64 Current, int32 AlreadyPending) {
    const int64 Delta = FMath::Clamp<int64>(Current - Previous, 0, 4);
    return FMath::Min(FMath::Max(AlreadyPending, 0) + static_cast<int32>(Delta), 4);
}
