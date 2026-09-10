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
#include "Misc/Base64.h"

// Connect on the very first tick rather than after a retry interval, so pressing Play does not
// begin with three seconds of an empty village.
void UTVBridgeSubsystem::Initialize(FSubsystemCollectionBase& Collection) { Super::Initialize(Collection); RetryClock = 1000; }
void UTVBridgeSubsystem::Deinitialize() {
    UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE PIE ending; releasing controller"));
    if (Socket) { Socket->OnConnected().Clear(); Socket->OnConnectionError().Clear(); Socket->OnClosed().Clear(); Socket->OnMessage().Clear(); Socket->Close(); Socket.Reset(); }
    Bodies.Empty(); Super::Deinitialize();
}
void UTVBridgeSubsystem::Connect() {
    if (Socket) { Socket->OnMessage().Clear(); Socket->OnConnected().Clear(); Socket->OnConnectionError().Clear(); Socket->OnClosed().Clear(); Socket->Close(); }
    // The bridge admits a client that proves it is not a web page. A browser cannot set a custom
    // header on a WebSocket handshake; this client can. Absence of an Origin header cannot be the
    // proof, because libwebsockets sends `Origin: http://127.0.0.1` on our behalf whether we want
    // it or not -- which is what used to get every one of these connections refused.
    bTransportConnected=false; bCanonicalReady=false; bWasLive=false; SnapshotCount=0; SinceSnapshot=100;
    Assembly.Empty(); PendingPresentation.Reset(); WantedRegions.Empty(); ProjectedRegions=0;
    if(WorldProjection) WorldProjection->ResetRegions();
    UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE connecting; regional protocol=2 text_limit=262144"));
    const TMap<FString, FString> UpgradeHeaders = { { TEXT("X-Torn-Veil-Client"), TEXT("unreal") }, { TEXT("X-Torn-Veil-Region-Protocol"), TEXT("2") } };
    Socket = FWebSocketsModule::Get().CreateWebSocket(TEXT("ws://127.0.0.1:8787"), FString(), UpgradeHeaders);
    // Wire chunks are <=128 KiB; assembly is separately bounded to 4 MiB.
    Socket->SetTextMessageMemoryLimit(256 * 1024);
    Socket->OnConnected().AddWeakLambda(this, [this]() { bTransportConnected=true; Status = TEXT("Connected - waiting for canonical state"); Sequence = 0; UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE connected")); });
    Socket->OnConnectionError().AddWeakLambda(this, [this](const FString& Error) { Status = TEXT("Simulation offline - run npm run bridge:playable"); bControls = false; bTransportConnected=false; UE_LOG(LogTemp,Warning,TEXT("TV_BRIDGE connection error: %s"),*Error); });
    Socket->OnClosed().AddWeakLambda(this, [this](int32 Code, const FString& Reason, bool Clean) { Status = TEXT("Disconnected - reconnecting"); bControls = false; bTransportConnected=false; UE_LOG(LogTemp,Warning,TEXT("TV_BRIDGE closed code=%d clean=%d reason=%s"),Code,Clean,*Reason); });
    Socket->OnMessage().AddWeakLambda(this, [this](const FString& Message) { Receive(Message); });
    Socket->Connect();
}
void UTVBridgeSubsystem::Tick(float Dt) {
    SinceSnapshot = bCanonicalReady ? FPlatformTime::Seconds()-LastSnapshotReceived : 100; RetryClock += Dt;
    ResultClock += Dt; if (ResultClock > 2.5f && !LastResult.IsEmpty()) LastResult.Empty();
    if ((!Socket || !Socket->IsConnected()) && RetryClock > 3) { RetryClock = 0; Connect(); }
    SendClock += Dt;
    const bool Live=IsLive();
    if(Live!=bWasLive) { UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE canonical %s snapshot_age=%.3f transport=%d"),Live?TEXT("LIVE"):TEXT("stalled"),SinceSnapshot,bTransportConnected); bWasLive=Live; }
    if (bControls && Live && SendClock >= 0.05f) {
        SendClock = 0;
        if (auto* P = Cast<ATVCharacter>(UGameplayStatics::GetPlayerCharacter(GetWorld(), 0))) {
            auto M = MakeShared<FJsonObject>(); const FVector D = P->IntentDirection();
            if(bMovingInput!=!D.IsNearlyZero()) { bMovingInput=!D.IsNearlyZero(); UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE move intent active=%d x=%.2f z=%.2f"),bMovingInput,D.X,D.Y); }
            M->SetStringField(TEXT("type"), TEXT("move")); M->SetNumberField(TEXT("x"), D.X); M->SetNumberField(TEXT("z"), D.Y); M->SetBoolField(TEXT("sprint"), P->IsSprinting()); Send(M);
        }
    }
    // Network callbacks only assemble bounded data. Apply one completed transfer here,
    // after liveness/input, and acknowledge only once projection has consumed it.
    if(PendingPresentation) {
        if(TransferRegion.IsEmpty() || WantedRegions.Contains(TransferRegion)) {
            if(!WorldProjection) WorldProjection=GetWorld()->SpawnActor<ATVWorldProjection>();
            WorldProjection->Apply(PendingPresentation,CanonicalOrigin);
            ProjectedRegions=WorldProjection->RegionCount(); ProjectionMetrics=WorldProjection->Metrics();
            UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE applied transfer=%d region=%s resident=%d snapshot_age=%.3f"),TransferId,*TransferRegion,ProjectedRegions,SinceSnapshot);
        }
        PendingPresentation.Reset(); AcknowledgePresentation(TransferId,ChunkCount-1);
    }
}
bool UTVBridgeSubsystem::IsLive() const { return bTransportConnected && bCanonicalReady && FPlatformTime::Seconds()-LastSnapshotReceived<1.5; }
FString UTVBridgeSubsystem::ConnectionStatus() const {
    if(!bTransportConnected) return Status;
    if(!bCanonicalReady) return TEXT("Connected - waiting for canonical player snapshot");
    if(!IsLive()) return TEXT("Transport connected - canonical snapshots stalled; movement paused");
    return Status+(ProjectedRegions<WantedRegions.Num()?FString::Printf(TEXT(" | streaming world %d/%d"),ProjectedRegions,WantedRegions.Num()):TEXT(""));
}
void UTVBridgeSubsystem::ProtocolError(const FString& Reason) { UE_LOG(LogTemp,Error,TEXT("TV_BRIDGE protocol error: %s"),*Reason); bCanonicalReady=false; Status=Reason; if(Socket) Socket->Close(1002,Reason); }
void UTVBridgeSubsystem::AcknowledgePresentation(int32 Id,int32 Index) {
    if(!Socket || !Socket->IsConnected()) return;
    Socket->Send(FString::Printf(TEXT("{\"version\":1,\"type\":\"presentation_ack\",\"transferId\":%d,\"index\":%d}"),Id,Index));
}
void UTVBridgeSubsystem::ReceivePresentation(const TSharedPtr<FJsonObject>& M) {
    const int32 Id=M->GetIntegerField(TEXT("transferId")),Index=M->GetIntegerField(TEXT("index")),Count=M->GetIntegerField(TEXT("count"));
    if(M->GetIntegerField(TEXT("streamVersion"))!=2 || Count<1 || Count>64 || Index<0 || Index>=Count || PendingPresentation) { ProtocolError(TEXT("Invalid regional chunk envelope")); return; }
    if(Index==0) { if(!Assembly.IsEmpty()) { ProtocolError(TEXT("Overlapping regional transfer"));return; } TransferId=Id;NextChunk=0;ChunkCount=Count;TransferRegion=M->GetStringField(TEXT("regionId")); }
    if(Id!=TransferId || Index!=NextChunk || Count!=ChunkCount) { ProtocolError(TEXT("Out-of-order regional chunk"));return; }
    TArray<uint8> Bytes;
    if(!FBase64::Decode(M->GetStringField(TEXT("data")),Bytes) || Bytes.Num()>65536 || Assembly.Num()+Bytes.Num()>4*1024*1024) { ProtocolError(TEXT("Regional assembly exceeds bounded protocol"));return; }
    Assembly.Append(Bytes); ++NextChunk;
    if(NextChunk<ChunkCount) { AcknowledgePresentation(Id,Index);return; }
    const int32 Total=Assembly.Num(); Assembly.Add(0);
    const FString Json=UTF8_TO_TCHAR(reinterpret_cast<const char*>(Assembly.GetData())); Assembly.Empty();
    if(!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json),PendingPresentation)) { ProtocolError(TEXT("Invalid regional JSON"));return; }
    UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE received presentation transfer=%d region=%s bytes=%d chunks=%d"),Id,*TransferRegion,Total,Count);
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
    if (!IsLive()) return;
    const FString Id = bConsume ? ConsumeInteraction : NearbyInteraction;
    if (Id.IsEmpty()) return;
    auto M = MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"), TEXT("interact"));
    M->SetStringField(TEXT("interactionId"), Id); Send(M);
}
void UTVBridgeSubsystem::SendDropIntent() {
    if (!IsLive() || DropInteraction.IsEmpty()) return;
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
    if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Message), M) || !M.IsValid()) {ProtocolError(TEXT("Invalid bridge JSON"));return;}
    double Version = 0; if (!M->TryGetNumberField(TEXT("version"), Version) || Version != 1) { Status = TEXT("Incompatible bridge protocol"); bControls = false; return; }
    FString Type; if (!M->TryGetStringField(TEXT("type"), Type)) return;
    if (Type == TEXT("hello")) { M->TryGetBoolField(TEXT("controls"), bControls); M->TryGetStringField(TEXT("playerId"), PlayerId); UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE received hello controls=%d player=%s"),bControls,*PlayerId); return; }
    if (Type == TEXT("scene")) {
        UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE received scene chars=%d"),Message.Len());
        // Where the canonical world's origin is, and how many centimetres a canonical metre is,
        // are TypeScript's to state. Reading them here keeps one source of truth for the
        // projection instead of a constant duplicated in this client.
        const TSharedPtr<FJsonObject>* Origin;
        if (M->TryGetObjectField(TEXT("origin"), Origin)) CanonicalOrigin = FVector((*Origin)->GetNumberField(TEXT("x")), (*Origin)->GetNumberField(TEXT("y")), (*Origin)->GetNumberField(TEXT("z")));
        double Units = 0; if (M->TryGetNumberField(TEXT("unitsPerMetre"), Units) && Units > 0) UnitsPerMetre = static_cast<float>(Units);
        return;
    }
    if (Type == TEXT("presentation_chunk")) { ReceivePresentation(M);return; }
    if (Type == TEXT("regions_state")) {
        if(M->GetIntegerField(TEXT("streamVersion"))!=2) {ProtocolError(TEXT("Regional protocol mismatch"));return;}
        CenterRegion=M->GetStringField(TEXT("center")); WantedRegions.Empty();
        for(const auto& V:M->GetArrayField(TEXT("resident"))) WantedRegions.Add(V->AsString());
        const auto O=M->GetObjectField(TEXT("origin")); const FVector Next(O->GetNumberField(TEXT("x")),O->GetNumberField(TEXT("y")),O->GetNumberField(TEXT("z")));
        const FVector Delta((CanonicalOrigin.X-Next.X)*100,(CanonicalOrigin.Z-Next.Z)*100,(CanonicalOrigin.Y-Next.Y)*100);
        if(!Delta.IsNearlyZero()) for(auto& Pair:Bodies) Pair.Value->RebasePresentation(Delta);
        CanonicalOrigin=Next;
        if(!WorldProjection) WorldProjection=GetWorld()->SpawnActor<ATVWorldProjection>();
        WorldProjection->Apply(M,CanonicalOrigin); ProjectedRegions=WorldProjection->RegionCount(); ProjectionMetrics=WorldProjection->Metrics();
        UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE region state center=%s wanted=%d origin=%s"),*CenterRegion,WantedRegions.Num(),*CanonicalOrigin.ToString()); return;
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
    const FString ControlledId=M->GetStringField(TEXT("controlledBodyId"));
    if(ControlledId.IsEmpty() || !Rows->ContainsByPredicate([&](const auto& V){return V->AsObject()->GetStringField(TEXT("bodyId"))==ControlledId && V->AsObject()->GetStringField(TEXT("entityId"))==M->GetStringField(TEXT("playerId"));})) { ProtocolError(TEXT("Canonical player body missing from snapshot"));return; }
    ServerTick = M->GetNumberField(TEXT("tick")); SinceSnapshot = 0; LastSnapshotReceived=FPlatformTime::Seconds(); ++SnapshotCount; M->TryGetStringField(TEXT("playerId"), PlayerId);
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
            if(!bCanonicalReady) UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE received snapshot; bound player=%s body=%s pawn=%s pos=%s"),*Entity,*Id,*C->GetName(),*C->GetActorLocation().ToString());
            bCanonicalReady=true;
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
void UTVBridgeSubsystem::ChooseMechanism(int32 Index) { if(!IsLive() || !MechanismIntents.IsValidIndex(Index)) return; auto M=MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"),TEXT("person_action")); M->SetObjectField(TEXT("intent"),MechanismIntents[Index]); Send(M); }
void UTVBridgeSubsystem::SaveWorld() { auto M=MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"),TEXT("save")); Send(M); }
void UTVBridgeSubsystem::RequestDeveloperInspection() { if(auto* T=Selected()) { auto M=MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"),TEXT("debug_inspect")); M->SetStringField(TEXT("personId"),T->EntityId); Send(M); } }
