#include "TVWorldProjection.h"
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
    // The bridge admits a client that proves it is not a web page. A browser cannot set a custom
    // header on a WebSocket handshake; this client can. Absence of an Origin header cannot be the
    // proof, because libwebsockets sends `Origin: http://127.0.0.1` on our behalf whether we want
    // it or not -- which is what used to get every one of these connections refused.
    const TMap<FString, FString> UpgradeHeaders = { { TEXT("X-Torn-Veil-Client"), TEXT("unreal") } };
    Socket = FWebSocketsModule::Get().CreateWebSocket(TEXT("ws://127.0.0.1:8787"), FString(), UpgradeHeaders);
    // A bounded nine-region frame with 2m settlement terrain exceeds the engine default.
    Socket->SetTextMessageMemoryLimit(8 * 1024 * 1024);
    Socket->OnConnected().AddWeakLambda(this, [this]() { Status = TEXT("Connected - waiting for canonical state"); Sequence = 0; });
    Socket->OnConnectionError().AddWeakLambda(this, [this](const FString& Error) { Status = TEXT("Simulation offline - run npm run bridge"); bControls = false; UE_LOG(LogTemp,Warning,TEXT("TV_BRIDGE %s"),*Error); });
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
void UTVBridgeSubsystem::SendHandIntent(bool bConsume) {
    if (SinceSnapshot >= 0.5f) return;
    const FString Id = bConsume ? ConsumeInteraction : NearbyInteraction;
    if (Id.IsEmpty()) return;
    auto M = MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"), TEXT("interact"));
    M->SetStringField(TEXT("interactionId"), Id); Send(M);
}
void UTVBridgeSubsystem::SendDropIntent() {
    if (SinceSnapshot >= 0.5f || DropInteraction.IsEmpty()) return;
    auto M = MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"), TEXT("interact"));
    M->SetStringField(TEXT("interactionId"), DropInteraction); Send(M);
}
void UTVBridgeSubsystem::Interact() {
    if (bDialogueOpen) { ChooseDialogueOption(0); return; }
    if (!TalkTargetBody.IsEmpty()) { SendIntent(TEXT("talk"), TalkTargetBody); return; }
    SendHandIntent(false);
}
void UTVBridgeSubsystem::CloseDialogue() {
    if (!bDialogueOpen) return;
    auto M = MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"), TEXT("dialogue_close")); Send(M);
}
void UTVBridgeSubsystem::ChooseDialogueOption(int32 Index) {
    if(bMechanismsOpen) { ChooseMechanism(Index); return; }
    if (!bDialogueOpen || !DialogueOptionIds.IsValidIndex(Index)) return;
    auto M = MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"), TEXT("dialogue_option"));
    M->SetStringField(TEXT("optionId"), DialogueOptionIds[Index]); Send(M);
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
    if (Type == TEXT("regions")) {
        const auto O=M->GetObjectField(TEXT("origin")); const FVector Next(O->GetNumberField(TEXT("x")),O->GetNumberField(TEXT("y")),O->GetNumberField(TEXT("z")));
        const FVector Delta((CanonicalOrigin.X-Next.X)*100,(CanonicalOrigin.Z-Next.Z)*100,(CanonicalOrigin.Y-Next.Y)*100);
        if(!Delta.IsNearlyZero()) for(auto& Pair:Bodies) Pair.Value->RebasePresentation(Delta);
        CanonicalOrigin=Next;
        if(!WorldProjection) WorldProjection=GetWorld()->SpawnActor<ATVWorldProjection>();
        WorldProjection->Apply(M,CanonicalOrigin); ProjectionMetrics=WorldProjection->Metrics(); return;
    }
    if (Type == TEXT("debug_inspection")) {
        if(auto* T=Selected()) { FString Text; FJsonSerializer::Serialize(M.ToSharedRef(),TJsonWriterFactory<>::Create(&Text)); T->DebugText=Text; }
        return;
    }
    if (Type == TEXT("result")) {
        FString Result; M->TryGetStringField(TEXT("result"), Result);
        if (Result == TEXT("accepted")) return;
        // The simulation's refusals, said plainly. The codes themselves are the canonical answer;
        // this only chooses the wording shown to the player.
        LastResult = Result == TEXT("out_of_reach") ? FString(TEXT("Too far to reach."))
            : Result == TEXT("no_target") ? TEXT("Nothing in reach.")
            : Result == TEXT("cooldown") ? TEXT("Still recovering.")
            : Result == TEXT("incapacitated") ? TEXT("You cannot act.")
            : Result == TEXT("no_resource") || Result == TEXT("unavailable_resource") ? TEXT("Nothing here to gather.")
            : Result;
        ResultClock = 0;
        return;
    }
    if (Type != TEXT("snapshot")) return;
    const TArray<TSharedPtr<FJsonValue>>* Rows;
    if (!M->TryGetArrayField(TEXT("bodies"), Rows)) return;
    ServerTick = M->GetNumberField(TEXT("tick")); SinceSnapshot = 0; M->TryGetStringField(TEXT("playerId"), PlayerId);
    NearbyInteraction.Empty(); ConsumeInteraction.Empty(); DropInteraction.Empty(); NearbyPrompt.Empty(); ConsumePrompt.Empty(); DropPrompt.Empty(); TalkTargetBody.Empty();
    const TArray<TSharedPtr<FJsonValue>>* Interactions;
    if (M->TryGetArrayField(TEXT("interactions"), Interactions)) for (const auto& V : *Interactions) {
        const auto A = V->AsObject(); if (!A) continue;
        const FString Slot = A->GetStringField(TEXT("slot"));
        FString& Id = Slot == TEXT("consume") ? ConsumeInteraction : Slot == TEXT("drop") ? DropInteraction : NearbyInteraction;
        FString& Prompt = Slot == TEXT("consume") ? ConsumePrompt : Slot == TEXT("drop") ? DropPrompt : NearbyPrompt;
        if (Id.IsEmpty()) { Id = A->GetStringField(TEXT("id")); Prompt = A->GetStringField(TEXT("label")); }
    }
    const TArray<TSharedPtr<FJsonValue>>* TalkTargets;
    if (M->TryGetArrayField(TEXT("talkTargets"), TalkTargets) && TalkTargets->Num()) {
        const auto Talk = (*TalkTargets)[0]->AsObject();
        if (Talk) {
            TalkTargetBody = Talk->GetStringField(TEXT("bodyId"));
            NearbyPrompt = FString::Printf(TEXT("Talk to %s"), *Talk->GetStringField(TEXT("name")));
        }
    }
    const TSharedPtr<FJsonObject>* Dialogue;
    if (M->TryGetObjectField(TEXT("dialogue"), Dialogue) && Dialogue && Dialogue->IsValid()) {
        bDialogueOpen = true;
        DialogueSpeaker = (*Dialogue)->GetStringField(TEXT("name"));
        DialogueOccupation = (*Dialogue)->GetStringField(TEXT("occupation"));
        DialogueLines.Empty(); DialogueOptionIds.Empty(); DialogueOptionLabels.Empty();
        const TArray<TSharedPtr<FJsonValue>>* Lines;
        if ((*Dialogue)->TryGetArrayField(TEXT("lines"), Lines)) for (const auto& Line : *Lines) DialogueLines.Add(Line->AsString());
        const TArray<TSharedPtr<FJsonValue>>* Options;
        if ((*Dialogue)->TryGetArrayField(TEXT("options"), Options)) for (const auto& Value : *Options) {
            const auto Option = Value->AsObject(); if (!Option) continue;
            DialogueOptionIds.Add(Option->GetStringField(TEXT("id"))); DialogueOptionLabels.Add(Option->GetStringField(TEXT("label")));
        }
    } else {
        bDialogueOpen = false; DialogueSpeaker.Empty(); DialogueOccupation.Empty(); DialogueLines.Empty(); DialogueOptionIds.Empty(); DialogueOptionLabels.Empty();
    }
    MechanismLabels.Empty(); MechanismIntents.Empty();
    const TArray<TSharedPtr<FJsonValue>>* Mechanisms;
    if(M->TryGetArrayField(TEXT("mechanisms"),Mechanisms)) for(const auto& V:*Mechanisms) {
        const auto A=V->AsObject(); const TArray<TSharedPtr<FJsonValue>>* Actions;
        if(A->TryGetArrayField(TEXT("actions"),Actions)) for(const auto& Action:*Actions) { const auto O=Action->AsObject(); MechanismLabels.Add(O->GetStringField(TEXT("label"))); MechanismIntents.Add(O->GetObjectField(TEXT("intent"))); }
    }
    KnowledgeSummary.Empty(); const TSharedPtr<FJsonObject>* Knowledge;
    if(M->TryGetObjectField(TEXT("knowledge"),Knowledge)) {
        const TArray<TSharedPtr<FJsonValue>>* People;
        if((*Knowledge)->TryGetArrayField(TEXT("people"),People)) for(const auto& V:*People) { const auto P=V->AsObject(); if(P->GetStringField(TEXT("bodyId"))!=SelectedBody) continue;
            const TArray<TSharedPtr<FJsonValue>>* Beliefs; if(P->TryGetArrayField(TEXT("beliefs"),Beliefs)) for(const auto& Belief:*Beliefs) KnowledgeSummary+=Belief->AsObject()->GetStringField(TEXT("interpretation"))+TEXT(". ");
        }
    }
    TSet<FString> Present;
    for (const auto& V : *Rows) {
        const auto D = V->AsObject(); if (!D) continue;
        const FString Id = D->GetStringField(TEXT("bodyId")), Entity = D->GetStringField(TEXT("entityId")); Present.Add(Id); FString ControlledBody; M->TryGetStringField(TEXT("controlledBodyId"),ControlledBody); const bool Controlled=ControlledBody.IsEmpty()?Entity==PlayerId:Id==ControlledBody;
        ATVCharacter* C = Bodies.Contains(Id) ? Bodies[Id].Get() : nullptr; const bool First = !IsValid(C);
        if (First) {
            if (Controlled) C = Cast<ATVCharacter>(UGameplayStatics::GetPlayerCharacter(GetWorld(), 0));
            else { FActorSpawnParameters P; P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn; C = GetWorld()->SpawnActor<ATVCharacter>(FVector(0, 0, 300), FRotator::ZeroRotator, P); }
            if (!C) continue;
            C->bCanonicalPlayer = Controlled; Bodies.Add(Id, C);
        }
        C->Project(D, First);
        if (Controlled) {
            const auto Needs = D->GetObjectField(TEXT("needs"));
            PlayerVitals = FString::Printf(TEXT("Hunger %.0f%%   Thirst %.0f%%   %.0f silver"), Needs->GetNumberField(TEXT("hunger")) * 100, Needs->GetNumberField(TEXT("thirst")) * 100, D->GetNumberField(TEXT("wealth")));
            TArray<FString> Items;
            for (const auto& Item : D->GetArrayField(TEXT("inventory"))) {
                const auto I = Item->AsObject(); const double Qty = I->GetNumberField(TEXT("quantity"));
                if (Qty > 0) Items.Add(FString::Printf(TEXT("%s x%.0f"), *I->GetStringField(TEXT("name")), Qty));
            }
            CarriedSummary = Items.IsEmpty() ? TEXT("Empty hands") : FString::Join(Items, TEXT("  |  "));
        }
    }
    TArray<FString> Removed;
    for (const auto& Pair : Bodies) if (!Present.Contains(Pair.Key)) { if (IsValid(Pair.Value) && !Pair.Value->bCanonicalPlayer) Pair.Value->Destroy(); Removed.Add(Pair.Key); }
    for (const auto& Id : Removed) Bodies.Remove(Id);
    const TArray<TSharedPtr<FJsonValue>>* Events;
    if (M->TryGetArrayField(TEXT("events"), Events) && Events->Num()) LastEvent = Events->Last()->AsObject()->GetStringField(TEXT("summary"));
    Status = FString::Printf(TEXT("LIVE  |  %d visible people  |  t %.1fs%s"), FMath::Max(0, Bodies.Num() - 1), ServerTick, bControls ? TEXT("") : TEXT("  |  observer connection"));
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

void UTVBridgeSubsystem::ToggleMechanisms() { bMechanismsOpen=!bMechanismsOpen; if(bMechanismsOpen) CloseDialogue(); }
void UTVBridgeSubsystem::ChooseMechanism(int32 Index) { if(SinceSnapshot>=.5f || !MechanismIntents.IsValidIndex(Index)) return; auto M=MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"),TEXT("person_action")); M->SetObjectField(TEXT("intent"),MechanismIntents[Index]); Send(M); }
void UTVBridgeSubsystem::SaveWorld() { auto M=MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"),TEXT("save")); Send(M); }
void UTVBridgeSubsystem::RequestDeveloperInspection() { if(auto* T=Selected()) { auto M=MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"),TEXT("debug_inspect")); M->SetStringField(TEXT("personId"),T->EntityId); Send(M); } }
