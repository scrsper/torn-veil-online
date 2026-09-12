#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Components/SkeletalMeshComponent.h"
#include "TVCombatPresentationComponent.h"
#include "TVWorldProjection.h"
#include "TVBridgeSubsystem.h"
#include "TVCharacter.h"
#include "TVHumanoidVisualState.h"
#include "WebSocketsModule.h"
#include "IWebSocket.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Kismet/GameplayStatics.h"
#include "GameFramework/PlayerController.h"
#include "Async/Async.h"
#include "Misc/Base64.h"
#include "TVInteractionSpec.generated.h"

// Connect on the very first tick rather than after a retry interval, so pressing Play does not
// begin with three seconds of an empty village.
static void TVSample(TArray<double>& Samples,double Value);
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
    bPredictionReady=false;InteractionEpoch.Empty();PendingMovement.Empty();CommandSentAt.Empty();PredictionColumns.Empty();PredictionAccumulator=0;LastConfirmedTick=-1;
    Assembly.Empty(); PendingPresentation.Reset(); WantedRegions.Empty(); ProjectedRegions=0;
    if(WorldProjection) WorldProjection->ResetRegions();
    UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE connecting; regional protocol=2 text_limit=262144"));
    const TMap<FString, FString> UpgradeHeaders = { { TEXT("X-Torn-Veil-Client"), TEXT("unreal") }, { TEXT("X-Torn-Veil-Region-Protocol"), TEXT("2") }, {TEXT("X-Torn-Veil-Interaction-Protocol"),TEXT("2")} };
    FString BridgeUrl=TEXT("ws://127.0.0.1:8787");
    const FString ArenaPort=FPlatformMisc::GetEnvironmentVariable(TEXT("TORN_VEIL_PORT"));
    if(ArenaPort.IsNumeric())BridgeUrl=FString::Printf(TEXT("ws://127.0.0.1:%s"),*ArenaPort);
    Socket = FWebSocketsModule::Get().CreateWebSocket(BridgeUrl, FString(), UpgradeHeaders);
    // Wire chunks are <=128 KiB; assembly is separately bounded to 4 MiB.
    Socket->SetTextMessageMemoryLimit(256 * 1024);
    Socket->OnConnected().AddWeakLambda(this, [this]() { bTransportConnected=true; Status = TEXT("Connected - waiting for canonical state"); Sequence = 0; UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE connected")); });
    Socket->OnConnectionError().AddWeakLambda(this, [this](const FString& Error) { Status = TEXT("Simulation offline - run npm run bridge:playable"); bControls = false; bTransportConnected=false; UE_LOG(LogTemp,Warning,TEXT("TV_BRIDGE connection error: %s"),*Error); });
    Socket->OnClosed().AddWeakLambda(this, [this](int32 Code, const FString& Reason, bool Clean) { Status = TEXT("Disconnected - reconnecting"); bControls = false; bTransportConnected=false; UE_LOG(LogTemp,Warning,TEXT("TV_BRIDGE closed code=%d clean=%d reason=%s"),Code,Clean,*Reason); });
    Socket->OnMessage().AddWeakLambda(this, [this](const FString& Message) { Receive(Message); });
    Socket->Connect();
}
void UTVBridgeSubsystem::Tick(float Dt) {
    if(CombatCorrectionStartedAt>=0&&RenderCorrection.Size()<.1){TVSample(CombatCorrectionSettleSamples,(FPlatformTime::Seconds()-CombatCorrectionStartedAt)*1000);CombatCorrectionStartedAt=-1;}
    SinceSnapshot = bCanonicalReady ? FPlatformTime::Seconds()-LastSnapshotReceived : 100; RetryClock += Dt;
    ResultClock += Dt; if (ResultClock > 2.5f && !LastResult.IsEmpty()) LastResult.Empty();
    if ((!Socket || !Socket->IsConnected()) && RetryClock > 3) { RetryClock = 0; Connect(); }
    SendClock += Dt;
    if(Socket&&Socket->IsConnected()&&bControls&&!InteractionEpoch.IsEmpty()&&FPlatformTime::Seconds()-ClockProbeAt>1){ClockProbeAt=FPlatformTime::Seconds();auto Probe=MakeShared<FJsonObject>();Probe->SetStringField(TEXT("type"),TEXT("clock_probe"));Probe->SetNumberField(TEXT("clientTimeMs"),ClockProbeAt*1000);FString Wire;FJsonSerializer::Serialize(Probe,TJsonWriterFactory<>::Create(&Wire));Socket->Send(Wire);}
    const bool Live=IsLive();
    if(Live!=bWasLive) { UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE canonical %s snapshot_age=%.3f transport=%d"),Live?TEXT("LIVE"):TEXT("stalled"),SinceSnapshot,bTransportConnected); bWasLive=Live; }
    if (InteractionEpoch.IsEmpty() && bControls && Live && SendClock >= 0.05f) {
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
    const FString Type=M->GetStringField(TEXT("type"));
    if(!InteractionEpoch.IsEmpty()&&(Type==TEXT("attack")||Type==TEXT("interact")||Type==TEXT("defend")||Type==TEXT("cancel"))) {
        LastResult=TEXT("Attempting...");ResultClock=0;PendingFeedbackSequence=SendCommand(M);return;
    }
    M->SetNumberField(TEXT("version"), 1); M->SetNumberField(TEXT("sequence"), ++Sequence);
    FString Out; auto Writer = TJsonWriterFactory<>::Create(&Out); FJsonSerializer::Serialize(M, Writer); Socket->Send(Out);
}
void UTVBridgeSubsystem::SendIntent(const FString& Type, const FString& TargetBody) {
    if(Type==TEXT("attack")){SendCombat(TEXT("attack"));return;}
    auto M = MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"), Type);
    const FString Target=TargetBody.IsEmpty()?SelectedBody:TargetBody;
    if(!Target.IsEmpty())M->SetStringField(TEXT("targetBodyId"),Target);Send(M);
}
static void TVSample(TArray<double>& Samples,double Value);
void UTVBridgeSubsystem::SendCombat(const FString& Kind,int32 Side,const FString& Trajectory,double CallbackAt,const FVector& Direction) {
    const double Begin=CallbackAt>0?CallbackAt:FPlatformTime::Seconds();
    if(!HasPrediction()||bDialogueOpen||bMechanismsOpen)return;
    BufferedCombat.Reset(); // newest press replaces the one pending follow-up
    auto M=MakeShared<FJsonObject>();M->SetStringField(TEXT("type"),Kind==TEXT("attack")?TEXT("attack"):TEXT("defend"));
    if(Kind==TEXT("attack")){M->SetStringField(TEXT("trajectory"),Trajectory);if(!SelectedBody.IsEmpty())M->SetStringField(TEXT("targetBodyId"),SelectedBody);}
    else {M->SetStringField(TEXT("kind"),Kind);M->SetNumberField(TEXT("side"),Side);}
    if(!Direction.IsNearlyZero()) {auto D=MakeShared<FJsonObject>();D->SetNumberField(TEXT("x"),Direction.X);D->SetNumberField(TEXT("z"),Direction.Z);M->SetObjectField(TEXT("direction"),D);}
    FBufferedCombat Input;Input.Kind=Kind;Input.Side=Side;Input.Trajectory=Trajectory;Input.Direction=Direction;
    Input.InputAt=Begin;Input.ExpiresAt=Begin+TVInteractionSpec::combatBufferSeconds;
    Input.CommandId=FString::Printf(TEXT("%s:%d"),*InteractionController,Sequence+1);
    Input.Sequence=SendCommand(M);PendingFeedbackSequence=Input.Sequence;if(Input.Sequence<0)return;
    const double Wait=PredictedCombat.TransitionAge(Kind)-CombatAge;
    if(Wait>1e-9) {
        if(Wait<=TVInteractionSpec::combatBufferSeconds&&PredictedCombat.Running(CombatAge)){Input.bBuffered=true;BufferedCombat=Input;LastResult=TEXT("Follow-up buffered");}
        else LastResult=TEXT("Committed - press closer to recovery");
        TVSample(CombatBufferSamples,(FPlatformTime::Seconds()-Begin)*1000);return;
    }
    StartPredictedCombat(Input);
}
void UTVBridgeSubsystem::StartPredictedCombat(const FBufferedCombat& Input) {
    const FString Previous=PredictedCombat.Variant;const bool Chain=PredictedCombat.IsAttack()&&CombatAge<=PredictedCombat.CompleteAt-PredictedCombat.StartedAt+.3;
    PredictedCombat=FTVLiveCombat::Predict(Input.Kind,Predicted.Yaw,Input.Side,Input.CommandId);
    PredictedCombat.ActorBodyId=InteractionBody;PredictedCombat.Trajectory=Input.Trajectory;
    PredictedCombat.Variant=Input.Trajectory==TEXT("low")?TEXT("kick"):Chain&&Previous==TEXT("direct")?TEXT("hook"):TEXT("direct");
    if(!Input.Direction.IsNearlyZero())PredictedCombat.Direction=Input.Direction;
    CombatAge=0;CombatCommandSequence=Input.Sequence;
    const double Now=FPlatformTime::Seconds(),Delay=(Now-Input.InputAt)*1000;
    if(Input.bBuffered)TVSample(CombatBufferedWaitSamples,Delay);
    else if(Input.Kind==TEXT("attack"))TVSample(AttackInputSamples,Delay);else TVSample(DefenseInputSamples,Delay);
    if(LastCombatStartAt>0)TVSample(CombatStartGapSamples,(Now-LastCombatStartAt)*1000);LastCombatStartAt=Now;
    if(auto* C=Bodies.FindRef(InteractionBody).Get())C->CombatPresentation->ObserveAction(PredictedCombat,0);
    TVSample(CombatAnimationSetupSamples,(FPlatformTime::Seconds()-Now)*1000);LastResult=TEXT("");
}
void UTVBridgeSubsystem::AdvanceCombatBuffer() {
    if(!BufferedCombat.IsSet())return;
    const auto Input=BufferedCombat.GetValue();
    if(FPlatformTime::Seconds()>Input.ExpiresAt||!Predicted.bEligible||PredictedCombat.Outcome==TEXT("interrupted")||PredictedCombat.Outcome==TEXT("cancelled")){BufferedCombat.Reset();return;}
    if(CombatAge+1e-9>=PredictedCombat.TransitionAge(Input.Kind)){
        TVSample(CombatTransitionLateSamples,FMath::Max(0.,CombatAge-PredictedCombat.TransitionAge(Input.Kind))*1000);
        BufferedCombat.Reset();StartPredictedCombat(Input);
    }
}
void UTVBridgeSubsystem::NoteInput() {InputCallbackAt=FPlatformTime::Seconds();}
static void TVSample(TArray<double>& Samples,double Value){if(Samples.Num()>=2048)Samples.RemoveAt(0);Samples.Add(Value);}
FString UTVBridgeSubsystem::RealtimeDiagnostics() const {
    auto Out=MakeShared<FJsonObject>();
    const auto Add=[&](const TCHAR* Name,TArray<double> Values){Values.Sort();auto S=MakeShared<FJsonObject>();S->SetNumberField(TEXT("count"),Values.Num());for(const auto& P:TArray<TPair<FString,double>>{{TEXT("p50"),.5},{TEXT("p95"),.95},{TEXT("p99"),.99}})S->SetNumberField(P.Key,Values.Num()?Values[FMath::Clamp(FMath::CeilToInt(Values.Num()*P.Value)-1,0,Values.Num()-1)]:0);Out->SetObjectField(Name,S);};
    Add(TEXT("interActionStartGapMs"),CombatStartGapSamples);Add(TEXT("inputToBufferedStateMs"),CombatBufferSamples);Out->SetNumberField(TEXT("bufferedCombatInputs"),BufferedCombat.IsSet()?1:0);
    Add(TEXT("bufferedInputToStartupMs"),CombatBufferedWaitSamples);Add(TEXT("bufferedTransitionLatenessMs"),CombatTransitionLateSamples);
    Add(TEXT("combatInputToAnimationSetupMs"),CombatAnimationSetupSamples);Add(TEXT("contactDecisionToPresentationMs"),ContactDecisionSamples);Out->SetNumberField(TEXT("clockUncertaintyMs"),ClockUncertaintyMs);
    Add(TEXT("inputToPredictedAttackMs"),AttackInputSamples);Add(TEXT("inputToPredictedDefenseMs"),DefenseInputSamples);Add(TEXT("combatCorrectionCm"),CombatCorrectionSamples);Add(TEXT("combatCorrectionCpuMs"),CombatCorrectionTimeSamples);Add(TEXT("combatCorrectionSettleMs"),CombatCorrectionSettleSamples);Add(TEXT("remoteActionAgeMs"),RemoteActionAgeSamples);Add(TEXT("contactReceiveToPresentationMs"),ContactReceiveSamples);
    Add(TEXT("combatAppliedRoundTripMs"),CombatAppliedRttSamples);
    Add(TEXT("commandSendToServerArrivalMs"),CommandOutboundSamples);Add(TEXT("serverArrivalToApplicationMs"),CommandApplicationSamples);Add(TEXT("applicationToClientReceiveMs"),CommandInboundSamples);
    Add(TEXT("predictionCpuMs"),PredictionSamples);Add(TEXT("inputCallbackToEngineStateMs"),InputToStateSamples);Add(TEXT("appliedRoundTripMs"),AppliedRttSamples);Add(TEXT("correctionCm"),CorrectionSamples);
    Out->SetNumberField(TEXT("pendingMovement"),PendingMovement.Num());Out->SetNumberField(TEXT("predictionCount"),PredictionCount);Out->SetBoolField(TEXT("predictionReady"),HasPrediction());
    Out->SetStringField(TEXT("presentationTiming"),TEXT("unmeasured; engine-state samples are not display presentation or physical input-to-photon"));
    Out->SetStringField(TEXT("specRevision"),TVInteractionSpec::revision);Out->SetStringField(TEXT("specHash"),TVInteractionSpec::hash);
    FString Json;FJsonSerializer::Serialize(Out,TJsonWriterFactory<>::Create(&Json));return Json;
}
int32 UTVBridgeSubsystem::SendCommand(const TSharedRef<FJsonObject>& Command) {
    if(!Socket||!Socket->IsConnected()||!bControls||InteractionEpoch.IsEmpty()) return -1;
    const int32 Seq=++Sequence;const double Now=FPlatformTime::Seconds();
    auto M=MakeShared<FJsonObject>();M->SetNumberField(TEXT("version"),2);M->SetStringField(TEXT("type"),TEXT("command"));
    M->SetStringField(TEXT("epoch"),InteractionEpoch);M->SetStringField(TEXT("controllerId"),InteractionController);M->SetStringField(TEXT("bodyId"),InteractionBody);
    M->SetNumberField(TEXT("sequence"),Seq);M->SetStringField(TEXT("commandId"),FString::Printf(TEXT("%s:%d"),*InteractionController,Seq));
    M->SetStringField(TEXT("specRevision"),TVInteractionSpec::revision);M->SetNumberField(TEXT("clientTimeMs"),Now*1000);M->SetObjectField(TEXT("command"),Command);
    FString Out;FJsonSerializer::Serialize(M,TJsonWriterFactory<>::Create(&Out));Socket->Send(Out);
    CommandSentAt.Add(Seq,Now);return Seq;
}
void UTVBridgeSubsystem::RefreshArenaBlocks() {
    if(!ArenaBlocks){auto* Owner=GetWorld()->SpawnActor<AActor>();ArenaBlocks=NewObject<UInstancedStaticMeshComponent>(Owner);Owner->SetRootComponent(ArenaBlocks);ArenaBlocks->SetStaticMesh(LoadObject<UStaticMesh>(nullptr,TEXT("/Engine/BasicShapes/Cube")));ArenaBlocks->SetCollisionEnabled(ECollisionEnabled::NoCollision);ArenaBlocks->RegisterComponent();}
    ArenaBlocks->ClearInstances();
    // Projection of the arena's canonical 48x48 stone substrate, top at one metre.
    ArenaBlocks->AddInstance(FTransform(FRotator::ZeroRotator,ToUnreal(FVector(24,.5,24))-FVector(0,0,90),FVector(48,48,1)),true);
    for(int32 X=GeometryX;X<GeometryX+GeometrySize;X++)for(int32 Z=GeometryZ;Z<GeometryZ+GeometrySize;Z++){const auto C=PredictionColumn(X,Z);if(!C.IsSet())continue;for(int32 Y:C->Solids)if(Y>0)ArenaBlocks->AddInstance(FTransform(FRotator::ZeroRotator,ToUnreal(FVector(X+.5,Y+.5,Z+.5))-FVector(0,0,90),FVector::OneVector),true);}
}
TOptional<FTVPredictionColumn> UTVBridgeSubsystem::PredictionColumn(int32 X,int32 Z) const {
    if(X<GeometryX||Z<GeometryZ||X>=GeometryX+GeometrySize||Z>=GeometryZ+GeometrySize)return {};
    const int32 Index=(X-GeometryX)*GeometrySize+Z-GeometryZ;
    return PredictionColumns.IsValidIndex(Index)?TOptional<FTVPredictionColumn>(PredictionColumns[Index]):TOptional<FTVPredictionColumn>();
}
void UTVBridgeSubsystem::PredictMovement(float Dt,const FVector& Direction,bool bSprint) {
    const double Begin=FPlatformTime::Seconds();
    if(!HasPrediction()||Begin-LastLocalStateAt>TVInteractionSpec::inputHorizonSeconds) {PredictionAccumulator=0;PredictionVelocity=FVector::ZeroVector;return;}
    PredictionAccumulator+=FMath::Min(static_cast<double>(Dt),.1);
    const FVector Before=Predicted.Position;const FTVMovementInput Input{Direction.X,Direction.Y,bSprint};
    int32 Count=0;
    while(PredictionAccumulator+1e-9>=TVInteractionSpec::stepSeconds&&Count++<6&&PendingMovement.Num()<15) {
        PredictionAccumulator-=TVInteractionSpec::stepSeconds;
        AdvanceCombatBuffer();
        const double SampleAge=CombatAge;
        if(PredictedCombat.Locked(CombatAge)){Predicted=PredictedCombat.Step(Predicted,CombatAge,TVInteractionSpec::stepSeconds,[this](int32 X,int32 Z){return PredictionColumn(X,Z);});CombatAge+=TVInteractionSpec::stepSeconds;}
        else Predicted=FTVInteractionPrediction::Step(Predicted,Input,TVInteractionSpec::stepSeconds,[this](int32 X,int32 Z){return PredictionColumn(X,Z);});
        auto C=MakeShared<FJsonObject>();C->SetStringField(TEXT("type"),TEXT("move"));C->SetNumberField(TEXT("x"),Input.X);C->SetNumberField(TEXT("z"),Input.Z);C->SetBoolField(TEXT("sprint"),Input.bSprint);
        const int32 Seq=SendCommand(C);if(Seq>=0)PendingMovement.Add({Seq,Input,PredictedCombat,SampleAge});
        ++PredictionCount;
    }
    if(PendingMovement.Num()>=15) PredictionAccumulator=0;
    const FVector Delta=Predicted.Position-Before;
    PredictionVelocity=FVector(Delta.X,Delta.Z,Delta.Y)*100/FMath::Max(.001f,Dt);
    LastPredictionMs=(FPlatformTime::Seconds()-Begin)*1000;MaxPredictionMs=FMath::Max(MaxPredictionMs,LastPredictionMs);
    TVSample(PredictionSamples,LastPredictionMs);
    if(InputCallbackAt>0&&Count>0) {LastInputToStateMs=(FPlatformTime::Seconds()-InputCallbackAt)*1000;TVSample(InputToStateSamples,LastInputToStateMs);InputCallbackAt=0;}
}
void UTVBridgeSubsystem::ReceiveLocalState(const TSharedPtr<FJsonObject>& M) {
    if(M->GetStringField(TEXT("epoch"))!=InteractionEpoch||M->GetStringField(TEXT("bodyId"))!=InteractionBody) return;
    const double Tick=M->GetNumberField(TEXT("tick"));if(Tick<LastConfirmedTick)return;
    LastConfirmedTick=Tick;LastLocalStateAt=FPlatformTime::Seconds();
    const TSharedPtr<FJsonObject>* Geometry;
    if(M->TryGetObjectField(TEXT("geometry"),Geometry)) {
        GeometryX=(*Geometry)->GetIntegerField(TEXT("x"));GeometryZ=(*Geometry)->GetIntegerField(TEXT("z"));GeometrySize=(*Geometry)->GetIntegerField(TEXT("size"));PredictionColumns.Empty();
        for(const auto& V:(*Geometry)->GetArrayField(TEXT("columns"))) {const auto C=V->AsObject();FTVPredictionColumn P;P.Floor=C->GetNumberField(TEXT("floor"));P.bWalkable=C->GetBoolField(TEXT("walkable"));for(const auto& Y:C->GetArrayField(TEXT("solids")))P.Solids.Add(static_cast<int32>(Y->AsNumber()));PredictionColumns.Add(P);}
    }
    if(bArena&&M->HasTypedField<EJson::Object>(TEXT("geometry")))RefreshArenaBlocks();
    const auto State=M->GetObjectField(TEXT("state")),Pos=State->GetObjectField(TEXT("pos"));
    Confirmed.Position=FVector(Pos->GetNumberField(TEXT("x")),Pos->GetNumberField(TEXT("y")),Pos->GetNumberField(TEXT("z")));
    Confirmed.Yaw=State->GetNumberField(TEXT("yaw"));Confirmed.Speed=State->GetNumberField(TEXT("speed"));Confirmed.bEligible=State->GetBoolField(TEXT("eligible"));
    const TSharedPtr<FJsonObject>* Practice;
    if(M->TryGetObjectField(TEXT("practice"),Practice)){
        PracticeStatus=FString::Printf(TEXT("SCRIPTED PRACTICE: %s | opponent %s | %s"),*(*Practice)->GetStringField(TEXT("mode")),*(*Practice)->GetStringField(TEXT("opponentPhase")),(*Practice)->GetBoolField(TEXT("ready"))?TEXT("ready"):TEXT("recover with F3"));
        PracticeLast=(*Practice)->GetStringField(TEXT("lastOutcome"));
    }
    const int32 Ack=M->GetIntegerField(TEXT("ack"));PendingMovement.RemoveAll([Ack](const auto& P){return P.Sequence<=Ack;});
    const double CorrectionBegin=FPlatformTime::Seconds();
    const bool CombatCorrection=PredictedCombat.IsValid()||CombatCommandSequence>Ack;
    const TSharedPtr<FJsonObject>* ActionJson;FTVLiveCombat Authority;
    const bool HasAuthority=M->TryGetObjectField(TEXT("combatAction"),ActionJson)&&FTVLiveCombat::Parse(*ActionJson,Authority);
    const bool Bound=HasAuthority&&!PredictedCombat.CommandId.IsEmpty()&&PredictedCombat.CommandId==Authority.CommandId;
    FString QueuedAuthority;M->TryGetStringField(TEXT("bufferedCombatCommandId"),QueuedAuthority);
    const bool Waiting=(CombatCommandSequence>Ack||QueuedAuthority==PredictedCombat.CommandId&&!QueuedAuthority.IsEmpty())&&!Bound;
    if(HasAuthority&&BufferedCombat.IsSet()&&
       (Authority.CommandId==BufferedCombat->CommandId||Authority.Outcome==TEXT("interrupted")||Authority.Outcome==TEXT("cancelled")))BufferedCombat.Reset();
    if(!Waiting) {
        PredictedCombat=HasAuthority?Authority:FTVLiveCombat();CombatAge=HasAuthority?FMath::Max(0.,Tick-Authority.StartedAt):0;
        if(HasAuthority)if(auto* C=Bodies.FindRef(InteractionBody).Get())C->CombatPresentation->ObserveAction(Authority,CombatAge);
    }
    const FVector Before=Predicted.Position;Predicted=Confirmed;
    double AuthorityAge=HasAuthority?FMath::Max(0.,Tick-Authority.StartedAt):0;
    for(const auto& P:PendingMovement) {
        if(Waiting) {
            // Replay the ledger's original startup age. Older authority cannot age or
            // restart a newer unacknowledged action every time a state arrives.
            const bool AfterInput=P.Sequence>CombatCommandSequence&&P.Action.CommandId==PredictedCombat.CommandId;
            const FTVLiveCombat& Replay=AfterInput?P.Action:Authority;
            const double ReplayAge=AfterInput?P.ActionAge:AuthorityAge;
            Predicted=Replay.Locked(ReplayAge)?Replay.Step(Predicted,ReplayAge,TVInteractionSpec::stepSeconds,[this](int32 X,int32 Z){return PredictionColumn(X,Z);}):FTVInteractionPrediction::Step(Predicted,P.Input,TVInteractionSpec::stepSeconds,[this](int32 X,int32 Z){return PredictionColumn(X,Z);});
            AuthorityAge+=TVInteractionSpec::stepSeconds;
        } else {
            if(PredictedCombat.Locked(CombatAge)){Predicted=PredictedCombat.Step(Predicted,CombatAge,TVInteractionSpec::stepSeconds,[this](int32 X,int32 Z){return PredictionColumn(X,Z);});CombatAge+=TVInteractionSpec::stepSeconds;}
            else Predicted=FTVInteractionPrediction::Step(Predicted,P.Input,TVInteractionSpec::stepSeconds,[this](int32 X,int32 Z){return PredictionColumn(X,Z);});
        }
    }
    if(bPredictionReady) {
        const FVector Error=Before-Predicted.Position;CorrectionCm=Error.Size()*100;MaxCorrectionCm=FMath::Max(MaxCorrectionCm,CorrectionCm);
        TVSample(CorrectionSamples,CorrectionCm);if(CombatCorrection){TVSample(CombatCorrectionSamples,CorrectionCm);TVSample(CombatCorrectionTimeSamples,(FPlatformTime::Seconds()-CorrectionBegin)*1000);}
        if(CorrectionCm>.1)++CorrectionCount;
        RenderCorrection=CorrectionCm<30?RenderCorrection+FVector(Error.X,Error.Z,Error.Y)*100:FVector::ZeroVector;
        RenderCorrection=RenderCorrection.GetClampedToMaxSize(25);
        if(CombatCorrection&&CorrectionCm>.1&&CombatCorrectionStartedAt<0)CombatCorrectionStartedAt=FPlatformTime::Seconds();
    }
    bPredictionReady=GeometrySize>0;
}
void UTVBridgeSubsystem::ObserveCombat(const TSharedPtr<FJsonObject>& J,double Tick,double ReceivedAtMs,bool Motion) {
    FTVLiveCombat A;if(!FTVLiveCombat::Parse(J,A))return;
    if(auto* C=Bodies.FindRef(A.ActorBodyId).Get()) {
        if(Motion)C->ProjectCombatMotion(J);
        if(A.ActorBodyId!=InteractionBody||!HasPrediction())C->CombatPresentation->ObserveAction(A,FMath::Max(0.,Tick-A.StartedAt));
    }
    const TSharedPtr<FJsonObject>* Contact;
    if(A.ContactAt>=0&&Tick-A.ContactAt<.25&&J->TryGetObjectField(TEXT("contact"),Contact)) {
        FString EventId;if(!(*Contact)->TryGetStringField(TEXT("eventId"),EventId)||PresentedContacts.Contains(EventId))return;
        PresentedContacts.Add(EventId);PresentedContactOrder.Add(EventId);if(PresentedContactOrder.Num()>256){PresentedContacts.Remove(PresentedContactOrder[0]);PresentedContactOrder.RemoveAt(0);}
        FString Body;(*Contact)->TryGetStringField(TEXT("bodyId"),Body);if(auto* C=Bodies.FindRef(Body).Get())C->CombatPresentation->ContactReaction();
        const double PresentedAtMs=FPlatformTime::Seconds()*1000;TVSample(ContactReceiveSamples,PresentedAtMs-ReceivedAtMs);
        double Decision=0;if(ClockUncertaintyMs<1e8&&(*Contact)->TryGetNumberField(TEXT("decidedAtMs"),Decision))TVSample(ContactDecisionSamples,PresentedAtMs+ClockOffsetMs-Decision);
        UE_LOG(LogTemp,Display,TEXT("TV_CONTACT_CLOCK receive=%.6f present=%.6f decision=%.6f offset=%.6f uncertainty=%.6f"),ReceivedAtMs,PresentedAtMs,Decision,ClockOffsetMs,ClockUncertaintyMs);
    }
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
    const double ReceivedAtMs=FPlatformTime::Seconds()*1000;
    TSharedPtr<FJsonObject> M;
    if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Message), M) || !M.IsValid()) {ProtocolError(TEXT("Invalid bridge JSON"));return;}
    double Version = 0; if (!M->TryGetNumberField(TEXT("version"), Version) || Version != 1) { Status = TEXT("Incompatible bridge protocol"); bControls = false; return; }
    FString Type; if (!M->TryGetStringField(TEXT("type"), Type)) return;
    if(Type==TEXT("clock_probe")){const double Rtt=ReceivedAtMs-M->GetNumberField(TEXT("clientTimeMs"));if(Rtt/2<ClockUncertaintyMs){ClockUncertaintyMs=Rtt/2;ClockOffsetMs=M->GetNumberField(TEXT("serverTimeMs"))-(ReceivedAtMs+M->GetNumberField(TEXT("clientTimeMs")))/2;}return;}
    if(Type==TEXT("combat_frame")){for(const auto& V:M->GetArrayField(TEXT("actions")))ObserveCombat(V->AsObject(),M->GetNumberField(TEXT("tick")),ReceivedAtMs,true);if(ClockUncertaintyMs<1e8)TVSample(RemoteActionAgeSamples,ReceivedAtMs+ClockOffsetMs-M->GetNumberField(TEXT("serverTimeMs")));return;}
    if(Type==TEXT("local_state")){ReceiveLocalState(M);return;}
    if(Type==TEXT("command_receipt")) {
        const int32 Seq=M->GetIntegerField(TEXT("sequence"));const FString ReceiptStatus=M->GetStringField(TEXT("status"));
        if(M->GetStringField(TEXT("epoch"))!=InteractionEpoch)return;
        if(ReceiptStatus!=TEXT("received")) {
            if(const double* At=CommandSentAt.Find(Seq)) {const double Rtt=(FPlatformTime::Seconds()-*At)*1000;TVSample(AppliedRttSamples,Rtt);if(Seq==CombatCommandSequence)TVSample(CombatAppliedRttSamples,Rtt);double Arrival=0,Applied=0;if(M->TryGetNumberField(TEXT("receivedAtMs"),Arrival)&&M->TryGetNumberField(TEXT("appliedAtMs"),Applied)){TVSample(CommandApplicationSamples,Applied-Arrival);if(ClockUncertaintyMs<1e8){TVSample(CommandOutboundSamples,Arrival-(*At*1000+ClockOffsetMs));TVSample(CommandInboundSamples,ReceivedAtMs+ClockOffsetMs-Applied);}}UE_LOG(LogTemp,VeryVerbose,TEXT("TV_COMMAND seq=%d status=%s roundtrip_ms=%.3f"),Seq,*ReceiptStatus,Rtt);}
            CommandSentAt.Remove(Seq);
            if(ReceiptStatus==TEXT("rejected")||ReceiptStatus==TEXT("cancelled")) {PendingMovement.RemoveAll([Seq](const auto& P){return P.Sequence==Seq;});
                if(BufferedCombat.IsSet()&&BufferedCombat->Sequence==Seq)BufferedCombat.Reset();
                if(Seq==CombatCommandSequence){if(auto* C=Bodies.FindRef(InteractionBody).Get())C->CombatPresentation->RejectAction(PredictedCombat.CommandId);PredictedCombat=FTVLiveCombat();}
                LastResult=M->GetStringField(TEXT("result"));ResultClock=0;}
            else if(Seq==PendingFeedbackSequence){LastResult=TEXT("Confirmed");ResultClock=0;PendingFeedbackSequence=-1;}
        }
        return;
    }
    if(Type==TEXT("hello")) {
        const TSharedPtr<FJsonObject>* Binding;
        if(M->TryGetObjectField(TEXT("interaction"),Binding)) {
            if((*Binding)->GetStringField(TEXT("specRevision"))!=TVInteractionSpec::revision||(*Binding)->GetStringField(TEXT("specHash"))!=TVInteractionSpec::hash){ProtocolError(TEXT("Interaction specification mismatch"));return;}
            InteractionEpoch=(*Binding)->GetStringField(TEXT("epoch"));InteractionController=(*Binding)->GetStringField(TEXT("controllerId"));InteractionBody=(*Binding)->GetStringField(TEXT("bodyId"));
            PendingMovement.Empty();CommandSentAt.Empty();BufferedCombat.Reset();LastCombatStartAt=0;PredictedCombat=FTVLiveCombat();CombatAge=0;CombatCommandSequence=-1;bPredictionReady=false;PredictionAccumulator=0;LastConfirmedTick=-1;
        }
    }
    if (Type == TEXT("hello")) { CombatCursor=FTVCombatReplayCursor(); for(const auto& Pair:Bodies) if(IsValid(Pair.Value)) Pair.Value->CombatPresentation->Cancel(); M->TryGetBoolField(TEXT("controls"), bControls); M->TryGetStringField(TEXT("playerId"), PlayerId); UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE received hello controls=%d player=%s"),bControls,*PlayerId); return; }
    if (Type == TEXT("scene")) {
        UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE received scene chars=%d"),Message.Len());
        // Where the canonical world's origin is, and how many centimetres a canonical metre is,
        // are TypeScript's to state. Reading them here keeps one source of truth for the
        // projection instead of a constant duplicated in this client.
        const TSharedPtr<FJsonObject>* Origin;
        if (M->TryGetObjectField(TEXT("origin"), Origin)) CanonicalOrigin = FVector((*Origin)->GetNumberField(TEXT("x")), (*Origin)->GetNumberField(TEXT("y")), (*Origin)->GetNumberField(TEXT("z")));
        double Units = 0; if (M->TryGetNumberField(TEXT("unitsPerMetre"), Units) && Units > 0) UnitsPerMetre = static_cast<float>(Units);
        M->TryGetBoolField(TEXT("arena"),bArena);if(bArena)RefreshArenaBlocks();
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
        FTVHumanoidVisualState Validated; FString VisualError;
        if (!FTVHumanoidVisualState::Parse(D, Validated, VisualError)) { UE_LOG(LogTemp, Warning, TEXT("TV_BRIDGE skipped malformed body row: %s"), *VisualError); continue; }
        const FString Id = Validated.BodyId, Entity = Validated.EntityId; Present.Add(Id); FString ControlledBody; M->TryGetStringField(TEXT("controlledBodyId"),ControlledBody); const bool Controlled=!ControlledBody.IsEmpty() && Id==ControlledBody;
        ATVCharacter* C = Bodies.Contains(Id) ? Bodies[Id].Get() : nullptr; const bool First = !IsValid(C);
        if (First) {
            // Only the unbound startup pawn can be adopted. Reusing a pawn already bound
            // to another body aliases two manifestations and lets cleanup destroy both.
            if (Controlled) {
                auto* StartupPawn = Cast<ATVCharacter>(UGameplayStatics::GetPlayerCharacter(GetWorld(), 0));
                if (StartupPawn && StartupPawn->BodyId.IsEmpty()) C = StartupPawn;
            }
            if (!C) { FActorSpawnParameters P; P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn; C = GetWorld()->SpawnActor<ATVCharacter>(FVector(0, 0, 300), FRotator::ZeroRotator, P); }
            if (!C) continue;
            Bodies.Add(Id, C);
        }
        C->bCanonicalPlayer = Controlled;
        C->bSemanticCombat=M->HasTypedField<EJson::Object>(TEXT("combatPresentation"));
        C->Project(D, First);
        if (Controlled) {
            if (auto* PC = GetWorld()->GetFirstPlayerController()) if (PC->GetPawn() != C) PC->Possess(C);
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
    const TSharedPtr<FJsonObject>* CombatStream;
    if (M->TryGetObjectField(TEXT("combatPresentation"),CombatStream)) {
        for (const auto& Event:CombatCursor.Read(*CombatStream)) {
            if(!Event.ActionId.IsEmpty())continue;
            auto* A=Bodies.FindRef(Event.ActorBodyId).Get();
            auto* T=Bodies.FindRef(Event.TargetBodyId).Get();
            if (!IsValid(A) || A->bIncapacitated) continue;
            FTVChoreographyRequest Request; Request.Event=Event; Request.LOD=A->CombatPresentation->LOD(); Request.ActorScale=A->GetMesh()->GetRelativeScale3D().X;
            auto Plan=FTVCombatChoreographer::Plan(Request);
            const double Start=FMath::Max(static_cast<double>(GetWorld()->GetTimeSeconds()),FMath::Max(A->CombatPresentation->AvailableAt,IsValid(T)?T->CombatPresentation->AvailableAt:0.0));
            A->CombatPresentation->Enqueue(Request,Plan,Start);
            if (IsValid(T) && !T->bIncapacitated && Event.Outcome==TEXT("hit")) {
                Request.bReaction=true; Request.LOD=T->CombatPresentation->LOD();
                auto Reaction=FTVCombatChoreographer::Plan(Request);
                Reaction.ContactAt=Plan.ContactAt; Reaction.Duration=Plan.Duration; Reaction.FX.HitStop=Plan.FX.HitStop;
                T->CombatPresentation->Enqueue(Request,Reaction,Start);
            }
        }
    }
    const TArray<TSharedPtr<FJsonValue>>* Actions;
    if(M->TryGetArrayField(TEXT("combatActions"),Actions))for(const auto& V:*Actions)ObserveCombat(V->AsObject(),ServerTick,ReceivedAtMs,false);
    TArray<FString> Removed;
    // bodyId is manifestation identity. A withdrawn body removes exactly its presentation actor,
    // including the possessed manifestation; another body of the same entity remains untouched.
    for (const auto& Pair : Bodies) if (!Present.Contains(Pair.Key)) {
        if (IsValid(Pair.Value)) {
            if (Pair.Value->bCanonicalPlayer && Pair.Value->GetController()) Pair.Value->GetController()->UnPossess();
            Pair.Value->Destroy();
        }
        Removed.Add(Pair.Key);
    }
    for (const auto& Id : Removed) Bodies.Remove(Id);
    if (!Present.Contains(ControlledId)) bCanonicalReady = false;
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

void UTVBridgeSubsystem::SetPractice(const FString& Mode) {
    if(!bArena||!IsLive())return;
    BufferedCombat.Reset();if(Mode==TEXT("reset")){PredictedCombat=FTVLiveCombat();CombatAge=0;LastCombatStartAt=0;PendingMovement.Empty();}
    auto M=MakeShared<FJsonObject>();M->SetStringField(TEXT("type"),TEXT("practice"));M->SetStringField(TEXT("mode"),Mode);PendingFeedbackSequence=SendCommand(M);
}
