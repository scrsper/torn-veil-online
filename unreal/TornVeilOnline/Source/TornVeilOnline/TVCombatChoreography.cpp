#include "TVCombatChoreography.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

namespace {
bool Number(const TSharedPtr<FJsonObject>& J, const TCHAR* Key, double& V) { return J && J->TryGetNumberField(Key,V) && FMath::IsFinite(V); }
bool Vector(const TSharedPtr<FJsonObject>& J, const TCHAR* Key, FVector& V) {
    const TSharedPtr<FJsonObject>* O; double X,Y,Z;
    if (!J || !J->TryGetObjectField(Key,O) || !Number(*O,TEXT("x"),X) || !Number(*O,TEXT("y"),Y) || !Number(*O,TEXT("z"),Z)) return false;
    V=FVector(X,Y,Z); return V.GetAbsMax()<1.e8;
}
float Smooth(float X) { X=FMath::Clamp(X,0.f,1.f); return X*X*(3-2*X); }
float Unit(float V) { return FMath::Clamp(V,0.f,1.f); }
}
bool FTVCombatEvent::Parse(const TSharedPtr<FJsonObject>& J, FTVCombatEvent& E) {
    E=FTVCombatEvent(); double N; FString Action;
    if(J)J->TryGetStringField(TEXT("actionId"),E.ActionId);
    if (!Number(J,TEXT("seq"),N) || N<1 || N>9007199254740991.0 || FMath::FloorToDouble(N)!=N) return false;
    E.Seq=static_cast<int64>(N);
    if (!J->TryGetStringField(TEXT("eventId"),E.EventId) || E.EventId.IsEmpty() || E.EventId.Len()>128 ||
        !J->TryGetStringField(TEXT("actorBodyId"),E.ActorBodyId) || E.ActorBodyId.IsEmpty() ||
        !J->TryGetStringField(TEXT("action"),Action) || Action!=TEXT("strike") ||
        !J->TryGetStringField(TEXT("outcome"),E.Outcome) || (E.Outcome!=TEXT("hit") && E.Outcome!=TEXT("miss")) ||
        !Vector(J,TEXT("actorPosition"),E.ActorPosition) || !Number(J,TEXT("physicalTime"),N)) return false;
    E.PhysicalTime=N;
    J->TryGetStringField(TEXT("targetBodyId"),E.TargetBodyId);
    if (!E.TargetBodyId.IsEmpty() && (!Vector(J,TEXT("targetPosition"),E.TargetPosition) || !Vector(J,TEXT("targetVelocity"),E.TargetVelocity))) return false;
    if (E.Outcome==TEXT("hit") && E.TargetBodyId.IsEmpty()) return false;
    if (!Number(J,TEXT("actorYaw"),N)) return false; E.ActorYaw=N;
    if (!Number(J,TEXT("attackSeq"),N) || N<0 || N>9007199254740991.0 || FMath::FloorToDouble(N)!=N) return false; E.AttackSeq=static_cast<int64>(N);
    if (!Number(J,TEXT("hitSeq"),N) || N<0 || N>9007199254740991.0 || FMath::FloorToDouble(N)!=N) return false; E.HitSeq=static_cast<int64>(N);
    if (!J->TryGetStringField(TEXT("weaponType"),E.WeaponType)) return false;
    J->TryGetStringField(TEXT("weaponId"),E.WeaponId);
    const TSharedPtr<FJsonObject>* C;
    if (!J->TryGetObjectField(TEXT("capability"),C) || !Number(*C,TEXT("strength"),N) || N<0 || N>2) return false; E.Strength=N;
    if (!Number(*C,TEXT("dexterity"),N) || N<0 || N>2) return false; E.Dexterity=N;
    if (!Number(*C,TEXT("exertion"),N) || N<0 || N>1) return false; E.Exertion=N;
    J->TryGetBoolField(TEXT("fixture"),E.bFixture);
    if (E.bFixture) {
        J->TryGetStringField(TEXT("techniqueId"),E.TechniqueId); J->TryGetStringField(TEXT("lineageId"),E.LineageId);
        J->TryGetStringField(TEXT("magicDomain"),E.MagicDomain);
        if (Number(J,TEXT("mastery"),N)) { E.bHasMastery=true; E.Mastery=Unit(N); }
    }
    return true;
}
uint32 FTVCombatChoreographer::StableHash(const FString& Text) {
    uint32 H=2166136261u; FTCHARToUTF8 Utf8(*Text);
    for (int32 I=0;I<Utf8.Length();++I) H=(H^static_cast<uint8>(Utf8.Get()[I]))*16777619u;
    return H;
}
FTVCombatStyleProfile FTVCombatStyleProfile::From(const FTVCombatEvent& E) {
    FTVCombatStyleProfile S;
    S.Force=Unit(E.Strength/1.25f); S.Control=Unit(E.Dexterity/1.15f);
    S.Economy=Unit(S.Control*.65f+E.Exertion*.35f);
    // No trade proficiency, occupation, personality, rank label or hidden cognition masquerades as combat skill.
    if (E.bFixture && E.bHasMastery) S.Control=Unit(.4f*S.Control+.6f*E.Mastery);
    S.Recovery=Unit(S.Control*.7f+E.Exertion*.3f);
    S.Complexity=S.Control>.8f?3:S.Control>.6f?2:S.Control>.35f?1:0;
    return S;
}
FTVTechniqueVisualSignature FTVTechniqueVisualSignature::From(const FTVCombatEvent& E) {
    FTVTechniqueVisualSignature S;
    const FString Anchor=!E.LineageId.IsEmpty()?E.LineageId:!E.TechniqueId.IsEmpty()?E.TechniqueId:E.ActorBodyId+TEXT(":")+E.WeaponType;
    S.Seed=FTVCombatChoreographer::StableHash(Anchor); S.Motif=S.Seed%3;
    S.RotationBias=(static_cast<int32>((S.Seed>>5)%11)-5)*.6f;
    S.Rhythm=.94f+((S.Seed>>10)%13)*.01f;
    // Ordinary trails use a neutral light; only explicit fixtures may claim an elemental colour.
    if (E.bFixture && !E.MagicDomain.IsEmpty()) S.Colour=FLinearColor(.14f,.75f,1.f);
    return S;
}
const TArray<FTVMotionPrimitive>& FTVCombatChoreographer::Primitives() {
    static TArray<FTVMotionPrimitive> Rows;
    static bool Loaded=false;
    if (!Loaded) {
        Loaded=true; FString Text; TSharedPtr<FJsonObject> J; const TArray<TSharedPtr<FJsonValue>>* Values=nullptr;
        if (FFileHelper::LoadFileToString(Text,*(FPaths::ProjectContentDir()/TEXT("TornVeil/Combat/Data/MotionPrimitives.json"))) &&
            FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text),J) && J && J->TryGetArrayField(TEXT("primitives"),Values) && Values) {
            for (const auto& Value:*Values) {
                auto R=Value->AsObject(); if (!R) continue; FTVMotionPrimitive P;
                P.Id=R->GetStringField(TEXT("id")); P.Family=R->GetStringField(TEXT("family")); P.AssetPath=R->GetStringField(TEXT("asset")); P.Effector=R->GetStringField(TEXT("effector"));
                P.ContactTime=R->GetNumberField(TEXT("contactTime")); P.Length=R->GetNumberField(TEXT("length"));
                P.ReachCm=R->GetNumberField(TEXT("reachCm")); P.LateralCm=R->GetNumberField(TEXT("lateralCm"));
                P.MinControl=R->GetNumberField(TEXT("minControl")); P.MaxControl=R->GetNumberField(TEXT("maxControl"));
                if(P.AssetPath.StartsWith(TEXT("/Game/TornVeil/")) && P.ContactTime>0 && P.Length>P.ContactTime) Rows.Add(P);
            }
        }
    }
    return Rows;
}
FString FTVCombatChoreographer::WeaponFamily(const FString& Type) {
    static const TMap<FString,FString> Families={{TEXT("unarmed"),TEXT("unarmed")},{TEXT("sword"),TEXT("blade_one_hand")},{TEXT("dagger"),TEXT("blade_one_hand")},
        {TEXT("axe"),TEXT("axe")},{TEXT("stoneaxe"),TEXT("axe")},{TEXT("hammer"),TEXT("blunt")}};
    if (const FString* F=Families.Find(Type)) return *F;
    return TEXT("improvised");
}
FTVChoreographyPlan FTVCombatChoreographer::Plan(const FTVChoreographyRequest& R) {
    FTVChoreographyPlan P; const auto& E=R.Event;
    P.Style=FTVCombatStyleProfile::From(E); P.Signature=FTVTechniqueVisualSignature::From(E);
    P.LOD=FMath::Clamp(R.LOD,0,2); P.bReaction=R.bReaction; P.WeaponFamily=WeaponFamily(E.WeaponType);
    TArray<const FTVMotionPrimitive*> Valid;
    const FString Family=R.bReaction?TEXT("reaction"):P.WeaponFamily;
    for (const auto& M:Primitives()) if (M.Family==Family && P.Style.Control>=M.MinControl && P.Style.Control<=M.MaxControl) Valid.Add(&M);
    // Unsupported weapon families use an explicitly generic body strike, never silently equip a sword.
    if (Valid.IsEmpty()) for (const auto& M:Primitives()) if (M.Family==TEXT("unarmed") && P.Style.Control>=M.MinControl && P.Style.Control<=M.MaxControl) Valid.Add(&M);
    if (!R.bReaction && !E.TargetBodyId.IsEmpty()) {
        const auto Delta=E.TargetPosition-E.ActorPosition;
        const float Facing=FMath::RadiansToDegrees(FMath::Atan2(-FMath::Cos(E.ActorYaw),-FMath::Sin(E.ActorYaw)));
        const auto Local=FRotator(0,-Facing,0).RotateVector(FVector(Delta.X,Delta.Z,Delta.Y));
        const float Bearing=FMath::RadiansToDegrees(FMath::Atan2(Local.Y,Local.X));
        const auto Aligned=Valid.FilterByPredicate([&](const auto* M) {
            const float HandBearing=FMath::RadiansToDegrees(FMath::Atan2(M->LateralCm,M->ReachCm));
            return FMath::Abs(FRotator::NormalizeAxis(Bearing-HandBearing))<=55;
        });
        // Select within the attainable directional vocabulary before applying bounded warp.
        // If no primitive fits, retain the bound and disclose residual error in diagnostics.
        if(Aligned.Num()) Valid=Aligned;
    }
    const uint32 Variation=StableHash(E.ActorBodyId+TEXT(":")+E.TechniqueId+FString::Printf(TEXT(":%lld"),E.Seq));
    if (!Valid.IsEmpty()) {
        // A persistent technique/lineage keeps its primary gesture. Event variation changes
        // timing within that gesture; ordinary unassigned strikes can use either hand.
        const uint32 Selection=E.TechniqueId.IsEmpty()?Variation:P.Signature.Seed;
        P.Motion=*Valid[Selection%Valid.Num()];
    }
    const float Tempo=1.f+(static_cast<int32>((Variation>>8)%5)-2)*.012f;
    P.Anticipation=FMath::Lerp(.30f,.15f,P.Style.Control)*P.Signature.Rhythm*Tempo;
    P.Strike=.12f; P.Recovery=FMath::Lerp(.42f,.22f,P.Style.Recovery)*P.Signature.Rhythm;
    P.ContactAt=P.Anticipation+P.Strike; P.Duration=P.ContactAt+P.Recovery;
    P.OffsetLimitCm=P.LOD==2?0:22;
    if (!E.TargetBodyId.IsEmpty()) {
        const FVector D=E.TargetPosition-E.ActorPosition;
        const float Facing=FMath::RadiansToDegrees(FMath::Atan2(-FMath::Cos(E.ActorYaw),-FMath::Sin(E.ActorYaw)));
        const FVector Local=FRotator(0,-Facing,0).RotateVector(FVector(D.X,D.Z,D.Y)*100);
        const float Bearing=FMath::RadiansToDegrees(FMath::Atan2(Local.Y,Local.X));
        P.LeanYaw=Bearing;
        const float EffectorBearing=FMath::RadiansToDegrees(FMath::Atan2(P.Motion.LateralCm,P.Motion.ReachCm));
        P.AlignmentYaw=FMath::Clamp(FRotator::NormalizeAxis(Bearing-EffectorBearing),-55.f,55.f);
        const float ArmReach=FVector2D(P.Motion.ReachCm,P.Motion.LateralCm).Size()*R.ActorScale;
        // Small anatomical lean, rather than unearned root travel, extends a distant entry.
        P.LeanDegrees=P.LOD<2?FMath::Clamp((Local.Size2D()-ArmReach-P.OffsetLimitCm)/2.f,0.f,12.f):0;
        const float LeanReach=120.f*FMath::Sin(FMath::DegreesToRadians(P.LeanDegrees));
        const FVector Reach=FRotator(0,P.AlignmentYaw,0).RotateVector(FVector(P.Motion.ReachCm,P.Motion.LateralCm,0)*R.ActorScale)
            +FVector(Local.X,Local.Y,0).GetSafeNormal()*LeanReach;
        P.ContactOffset=(FVector(Local.X,Local.Y,0)-Reach).GetClampedToMaxSize(P.OffsetLimitCm);
        P.ContactErrorCm=FVector::Dist2D(Local,Reach+P.ContactOffset);
    }
    P.PivotYaw=P.LOD==0 && P.Style.Complexity>=2 ? (P.Signature.Motif%2?-1.f:1.f)*(4+P.Style.Control*6):0;
    P.FX.Colour=P.Signature.Colour;
    P.FX.Trail=P.LOD==0?FMath::Lerp(.18f,.85f,P.Style.Control):0;
    P.FX.Impact=E.Outcome==TEXT("hit") && P.LOD<2?FMath::Lerp(.2f,.75f,P.Style.Force):0;
    P.FX.HitStop=P.FX.Impact>0?FMath::Lerp(.025f,.065f,P.Style.Control):0;
    P.FX.Camera=P.Style.Control>.65f?.65f:0;
    P.FX.bMagicFixture=E.bFixture && !E.MagicDomain.IsEmpty() && P.LOD==0;
    return P;
}
float FTVChoreographyPlan::SampleTime(float Age) const {
    if(bTimeline)return FMath::Clamp(Age,0.f,Motion.Length);
    if (bReaction) return FMath::Clamp((Age-ContactAt)*1.6f,0.f,Motion.Length);
    const float Windup=Motion.ContactTime*.65f;
    if (Age<Anticipation) return Windup*Smooth(Age/Anticipation);
    if (Age<ContactAt) return FMath::Lerp(Windup,Motion.ContactTime,(Age-Anticipation)/Strike);
    return FMath::Lerp(Motion.ContactTime,Motion.Length,Unit((Age-ContactAt)/Recovery));
}
float FTVChoreographyPlan::Weight(float Age) const {
    const float Start=bReaction?ContactAt:0;
    const float Fade=bTimeline?.09f:.12f;
    return Smooth((Age-Start)/(bTimeline?.04f:.09f))*(1-Smooth((Age-(Duration-Fade))/Fade));
}
FVector FTVChoreographyPlan::Offset(float Age) const {
    if (bReaction) return FVector::ZeroVector;
    const float Envelope=Age<ContactAt?Smooth(Age/ContactAt):1-Smooth((Age-ContactAt)/Recovery);
    return ContactOffset*Envelope;
}
float FTVChoreographyPlan::Yaw(float Age) const {
    if (bReaction) return 0;
    const float Align=Age<ContactAt?Smooth(Age/Anticipation):1-Smooth((Age-ContactAt)/Recovery);
    const float Pivot=Age<Anticipation?FMath::Sin(PI*Unit(Age/Anticipation)):0;
    return AlignmentYaw*Align+PivotYaw*Pivot;
}
float FTVChoreographyPlan::Lean(float Age) const {
    if(bReaction) return 0;
    return LeanDegrees*(Age<ContactAt?Smooth(Age/ContactAt):1-Smooth((Age-ContactAt)/Recovery));
}
TArray<FTVCombatEvent> FTVCombatReplayCursor::Read(const TSharedPtr<FJsonObject>& S) {
    TArray<FTVCombatEvent> Out; double Version,First,Last;
    const TArray<TSharedPtr<FJsonValue>>* Rows;
    if (!Number(S,TEXT("version"),Version) || Version!=1 || !Number(S,TEXT("firstAvailableSeq"),First) ||
        !Number(S,TEXT("latestSeq"),Last) || Last<0 || First<1 || First>Last+1 || Last>9007199254740991.0 ||
        FMath::FloorToDouble(First)!=First || FMath::FloorToDouble(Last)!=Last ||
        !S->TryGetArrayField(TEXT("events"),Rows) || Rows->Num()>128) { ++Invalid; return Out; }
    if (!bInitialized) {
        bInitialized=true; Latest=Last; LastDispatched=Latest;
        for (const auto& V:*Rows) {
            FTVCombatEvent E;
            if (!FTVCombatEvent::Parse(V->AsObject(),E) || E.Seq<First || E.Seq>Last || Seen.Contains(E.Seq) || Seen.FindKey(E.EventId)) { ++Invalid; continue; }
            Seen.Add(E.Seq,E.EventId);
        }
        return Out;
    }
    if (Last<Latest) { ++Late; return Out; } // A new server/session must explicitly reset the cursor.
    if (First>Latest+1) RetentionGap+=static_cast<int64>(First)-Latest-1;
    for (const auto& V:*Rows) {
        FTVCombatEvent E;
        if (!FTVCombatEvent::Parse(V->AsObject(),E) || E.Seq<First || E.Seq>Last) { ++Invalid; continue; }
        if (const FString* Id=Seen.Find(E.Seq)) { if (*Id==E.EventId) ++Duplicates; else ++Invalid; continue; }
        if (Seen.FindKey(E.EventId)) { ++Invalid; continue; }
        Seen.Add(E.Seq,E.EventId); Out.Add(E);
    }
    Out.Sort([](const auto& A,const auto& B){return A.Seq<B.Seq;});
    // Late perception may authorize older history later. Never insert it backwards into an
    // already playing fight; disclose that resynchronization rather than fabricate ordering.
    Out.RemoveAll([&](const auto& E){if(E.Seq<=LastDispatched){++Late;return true;}return false;});
    if(Out.Num()) LastDispatched=Out.Last().Seq;
    Latest=Last;
    for (auto It=Seen.CreateIterator();It;++It) if (It.Key()<First) It.RemoveCurrent();
    return Out;
}
