#include "TVBridgeSubsystem.h"
#include "TVCharacter.h"
#include "WebSocketsModule.h"
#include "IWebSocket.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Kismet/GameplayStatics.h"
#include "GameFramework/PlayerController.h"
#include "Async/Async.h"

// Connect on the very first tick rather than after a retry interval, so pressing Play does not
// begin with three seconds of an empty village.
void UTVBridgeSubsystem::Initialize(FSubsystemCollectionBase& Collection) { Super::Initialize(Collection); RetryClock = 1000; }
void UTVBridgeSubsystem::Deinitialize() {
    if (Socket) { Socket->OnConnected().Clear(); Socket->OnConnectionError().Clear(); Socket->OnClosed().Clear(); Socket->OnMessage().Clear(); Socket->Close(); Socket.Reset(); }
    Bodies.Empty(); Super::Deinitialize();
}
void UTVBridgeSubsystem::Connect() {
    if (Socket) { Socket->OnMessage().Clear(); Socket->OnConnected().Clear(); Socket->OnConnectionError().Clear(); Socket->OnClosed().Clear(); Socket->Close(); }
    Socket = FWebSocketsModule::Get().CreateWebSocket(TEXT("ws://127.0.0.1:8787"));
    Socket->OnConnected().AddWeakLambda(this, [this]() { Status = TEXT("Connected - waiting for canonical state"); Sequence = 0; });
    Socket->OnConnectionError().AddWeakLambda(this, [this](const FString& Error) { Status = TEXT("Simulation offline - run npm run bridge"); bControls = false; });
    Socket->OnClosed().AddWeakLambda(this, [this](int32, const FString&, bool) { Status = TEXT("Disconnected - reconnecting"); bControls = false; });
    Socket->OnMessage().AddWeakLambda(this, [this](const FString& Message) { Receive(Message); });
    Socket->Connect();
}
void UTVBridgeSubsystem::Tick(float Dt) {
    SinceSnapshot += Dt; RetryClock += Dt;
    ResultClock += Dt; if (ResultClock > 2.5f && !LastResult.IsEmpty()) LastResult.Empty();
    if ((!Socket || !Socket->IsConnected()) && RetryClock > 3) { RetryClock = 0; Connect(); }
    SendClock += Dt;
    if (bControls && SinceSnapshot < 0.5f && SendClock >= 0.05f) {
        SendClock = 0;
        if (auto* P = Cast<ATVCharacter>(UGameplayStatics::GetPlayerCharacter(GetWorld(), 0))) {
            auto M = MakeShared<FJsonObject>(); const FVector D = P->IntentDirection();
            M->SetStringField(TEXT("type"), TEXT("move")); M->SetNumberField(TEXT("x"), D.X); M->SetNumberField(TEXT("z"), D.Y); M->SetBoolField(TEXT("sprint"), P->IsSprinting()); Send(M);
        }
    }
}
void UTVBridgeSubsystem::Send(const TSharedRef<FJsonObject>& M) {
    if (!Socket || !Socket->IsConnected() || !bControls) return;
    M->SetNumberField(TEXT("version"), 1); M->SetNumberField(TEXT("sequence"), ++Sequence);
    FString Out; auto Writer = TJsonWriterFactory<>::Create(&Out); FJsonSerializer::Serialize(M, Writer); Socket->Send(Out);
}
void UTVBridgeSubsystem::SendIntent(const FString& Type, const FString& TargetBody) {
    auto M = MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"), Type);
    M->SetStringField(TEXT("targetBodyId"), TargetBody.IsEmpty() ? SelectedBody : TargetBody); Send(M);
}
void UTVBridgeSubsystem::Receive(const FString& Message) {
    TSharedPtr<FJsonObject> M;
    if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Message), M) || !M.IsValid()) return;
    double Version = 0; if (!M->TryGetNumberField(TEXT("version"), Version) || Version != 1) { Status = TEXT("Incompatible bridge protocol"); bControls = false; return; }
    FString Type; if (!M->TryGetStringField(TEXT("type"), Type)) return;
    if (Type == TEXT("hello")) { M->TryGetBoolField(TEXT("controls"), bControls); M->TryGetStringField(TEXT("playerId"), PlayerId); return; }
    if (Type == TEXT("scene")) {
        // Where the canonical world's origin is, and how many centimetres a canonical metre is,
        // are TypeScript's to state. Reading them here keeps one source of truth for the
        // projection instead of a constant duplicated in this client.
        const TSharedPtr<FJsonObject>* Origin;
        if (M->TryGetObjectField(TEXT("origin"), Origin)) CanonicalOrigin = FVector((*Origin)->GetNumberField(TEXT("x")), (*Origin)->GetNumberField(TEXT("y")), (*Origin)->GetNumberField(TEXT("z")));
        double Units = 0; if (M->TryGetNumberField(TEXT("unitsPerMetre"), Units) && Units > 0) UnitsPerMetre = static_cast<float>(Units);
        return;
    }
    if (Type == TEXT("result")) {
        FString Result; M->TryGetStringField(TEXT("result"), Result);
        if (Result == TEXT("accepted")) return;
        // The simulation's refusals, said plainly. The codes themselves are the canonical answer;
        // this only chooses the wording shown to the player.
        LastResult = Result == TEXT("out_of_reach") ? TEXT("Too far to reach.")
            : Result == TEXT("no_target") ? TEXT("Nothing in reach.")
            : Result == TEXT("cooldown") ? TEXT("Still recovering.")
            : Result == TEXT("incapacitated") ? TEXT("You cannot act.")
            : Result == TEXT("no_resource") ? TEXT("Nothing here to gather.")
            : Result;
        ResultClock = 0;
        return;
    }
    if (Type != TEXT("snapshot")) return;
    const TArray<TSharedPtr<FJsonValue>>* Rows;
    if (!M->TryGetArrayField(TEXT("bodies"), Rows)) return;
    ServerTick = M->GetNumberField(TEXT("tick")); SinceSnapshot = 0; M->TryGetStringField(TEXT("playerId"), PlayerId);
    TSet<FString> Present;
    for (const auto& V : *Rows) {
        const auto D = V->AsObject(); if (!D) continue;
        const FString Id = D->GetStringField(TEXT("bodyId")), Entity = D->GetStringField(TEXT("entityId")); Present.Add(Id);
        ATVCharacter* C = Bodies.Contains(Id) ? Bodies[Id].Get() : nullptr; const bool First = !IsValid(C);
        if (First) {
            if (Entity == PlayerId) C = Cast<ATVCharacter>(UGameplayStatics::GetPlayerCharacter(GetWorld(), 0));
            else { FActorSpawnParameters P; P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn; C = GetWorld()->SpawnActor<ATVCharacter>(FVector(0, 0, 300), FRotator::ZeroRotator, P); }
            if (!C) continue;
            C->bCanonicalPlayer = Entity == PlayerId; Bodies.Add(Id, C);
        }
        C->Project(D, First);
    }
    TArray<FString> Removed;
    for (const auto& Pair : Bodies) if (!Present.Contains(Pair.Key)) { if (IsValid(Pair.Value) && !Pair.Value->bCanonicalPlayer) Pair.Value->Destroy(); Removed.Add(Pair.Key); }
    for (const auto& Id : Removed) Bodies.Remove(Id);
    const TArray<TSharedPtr<FJsonValue>>* Events;
    if (M->TryGetArrayField(TEXT("events"), Events) && Events->Num()) LastEvent = Events->Last()->AsObject()->GetStringField(TEXT("summary"));
    Status = FString::Printf(TEXT("LIVE  |  %d canonical NPCs  |  t %.1fs%s"), FMath::Max(0, Bodies.Num() - 1), ServerTick, bControls ? TEXT("") : TEXT("  |  observer connection"));
}
ATVCharacter* UTVBridgeSubsystem::Selected() const { const auto* C = Bodies.Find(SelectedBody); return C ? C->Get() : nullptr; }
void UTVBridgeSubsystem::CycleTarget() {
    auto* P = UGameplayStatics::GetPlayerCharacter(GetWorld(), 0); if (!P) return;
    TArray<ATVCharacter*> Candidates;
    for (auto& Pair : Bodies) if (IsValid(Pair.Value) && !Pair.Value->bCanonicalPlayer && FVector::DistSquared(P->GetActorLocation(), Pair.Value->GetActorLocation()) < FMath::Square(1800.f)) Candidates.Add(Pair.Value);
    Candidates.Sort([P](const ATVCharacter& A, const ATVCharacter& B) { return FVector::DistSquared(P->GetActorLocation(), A.GetActorLocation()) < FVector::DistSquared(P->GetActorLocation(), B.GetActorLocation()); });
    if (Candidates.IsEmpty()) { SelectedBody.Empty(); return; }
    const int32 Index = Candidates.IndexOfByPredicate([this](const ATVCharacter* C) { return C->BodyId == SelectedBody; });
    SelectedBody = Candidates[(Index + 1) % Candidates.Num()]->BodyId;
}
