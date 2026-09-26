#include "TVBridgeSubsystem.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Components/SkeletalMeshComponent.h"
#include "TVCombatPresentationComponent.h"
#include "TVWorldProjection.h"
#include "TVCombatRepertoire.generated.h"
#include "TVCharacter.h"
#include "TVWildlifePresentation.h"
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
#include "TVSignInWidget.h"
#include "Framework/Application/SlateApplication.h"

// Connect on the very first tick rather than after a retry interval, so pressing Play does not
// begin with three seconds of an empty village.
static void TVSample(TArray<double>& Samples,double Value);
void UTVBridgeSubsystem::Initialize(FSubsystemCollectionBase& Collection) {
    Super::Initialize(Collection); RetryClock = 1000;
    ClientConfig = FTVClientConfig::Load();
    // A packaged client always plays the alpha: without saved credentials it starts at sign-in.
    // The editor keeps the legacy local developer bridge unless an account is configured.
#if !WITH_EDITOR
    if (!ClientConfig.IsComplete()) RequireSignIn(TEXT("Welcome. Sign in to join the world."));
#else
    if (ClientConfig.IsAlpha() && !ClientConfig.IsComplete()) RequireSignIn(TEXT("Complete the sign-in details."));
#endif
}
void UTVBridgeSubsystem::RequireSignIn(const FString& Message,bool bNewOnly) {
    bSignInRequired=true; bSignInNewOnly=bNewOnly; SignInMessage=Message;
    if(SignIn) SignIn->Prepare(ClientConfig,Message,bNewOnly);
}
void UTVBridgeSubsystem::SubmitSignIn(const FTVClientConfig& Config) {
    ClientConfig=Config; ClientConfig.Save(); bSignInRequired=false; SignInMessage.Empty(); RetryDelay=3; DeadSince=-1;
    RetryClock=1000; // connect on the next tick
}
void UTVBridgeSubsystem::UpdateSignIn() {
    auto* PC=GetWorld()->GetFirstPlayerController(); if(!PC||!PC->IsLocalController()) return;
    if(bSignInRequired&&!SignIn) {
        SignIn=CreateWidget<UTVSignInWidget>(PC); SignIn->Prepare(ClientConfig,SignInMessage,bSignInNewOnly);
        SignIn->OnSubmitted.BindUObject(this,&UTVBridgeSubsystem::SubmitSignIn);
        SignIn->AddToViewport(100);
        FInputModeUIOnly Mode; Mode.SetWidgetToFocus(SignIn->TakeWidget()); PC->SetInputMode(Mode); PC->SetShowMouseCursor(true);SignIn->FocusFirstControl();
    } else if(!bSignInRequired&&SignIn) {
        SignIn->RemoveFromParent(); SignIn=nullptr;
        PC->SetInputMode(FInputModeGameOnly()); PC->SetShowMouseCursor(false);
    } else if(SignIn) SignIn->SetMessage(SignInMessage);
}
void UTVBridgeSubsystem::Deinitialize() {
    if(PlayerShell){PlayerShell->RemoveFromParent();PlayerShell=nullptr;}
    UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE PIE ending; releasing controller"));
    if (Socket) { Socket->OnConnected().Clear(); Socket->OnConnectionError().Clear(); Socket->OnClosed().Clear(); Socket->OnMessage().Clear(); Socket->Close(); Socket.Reset(); }
    Bodies.Empty();WildlifeBodies.Empty(); Super::Deinitialize();
}
void UTVBridgeSubsystem::Connect() {
    if (Socket) { Socket->OnMessage().Clear(); Socket->OnConnected().Clear(); Socket->OnConnectionError().Clear(); Socket->OnClosed().Clear(); Socket->Close(); }
    // The bridge admits a client that proves it is not a web page. A browser cannot set a custom
    // header on a WebSocket handshake; this client can. Absence of an Origin header cannot be the
    // proof, because libwebsockets sends `Origin: http://127.0.0.1` on our behalf whether we want
    // it or not -- which is what used to get every one of these connections refused.
    bControls=false; bTransportConnected=false; bCanonicalReady=false; bWasLive=false; SnapshotCount=0; SinceSnapshot=100;
    ClearBufferedInput();
    if(auto* P=Cast<ATVCharacter>(UGameplayStatics::GetPlayerCharacter(GetWorld(),0)))P->RefreshInputContext(true);
    bPredictionReady=false;InteractionEpoch.Empty();PendingMovement.Empty();CommandSentAt.Empty();PredictionColumns.Empty();PredictionAccumulator=0;PredictionVelocity=FVector::ZeroVector;LastConfirmedTick=-1;
    Assembly.Empty(); PendingPresentation.Reset(); WantedRegions.Empty(); ProjectedRegions=0;
    for(auto& Pair:WildlifeBodies)if(IsValid(Pair.Value))Pair.Value->Destroy();WildlifeBodies.Empty();
    if(WorldProjection) WorldProjection->ResetRegions();
    const FString BridgeUrl=ClientConfig.Url();
    UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE connecting to %s as %s; regional protocol=2 alpha protocol=%d text_limit=262144"),*BridgeUrl,ClientConfig.IsAlpha()?*ClientConfig.Account:TEXT("(local developer bridge)"),FTVClientConfig::AlphaProtocol);
    Status=FString::Printf(TEXT("Connecting to %s..."),*BridgeUrl);
    Socket = FWebSocketsModule::Get().CreateWebSocket(BridgeUrl, FString(), ClientConfig.Headers());
    // Wire chunks are <=128 KiB; assembly is separately bounded to 4 MiB.
    Socket->SetTextMessageMemoryLimit(256 * 1024);
    Socket->OnConnected().AddWeakLambda(this, [this]() { bTransportConnected=true; Status = TEXT("Connected - waiting for canonical state"); Sequence = 0; UE_LOG(LogTemp,Display,TEXT("TV_BRIDGE connected")); });
    Socket->OnConnectionError().AddWeakLambda(this, [this](const FString& Error) { Status = ClientConfig.IsAlpha() ? FString::Printf(TEXT("Cannot reach the server at %s - retrying"),*ClientConfig.Server) : FString(TEXT("Simulation offline - run npm run bridge:playable")); bControls = false; bTransportConnected=false; UE_LOG(LogTemp,Warning,TEXT("TV_BRIDGE connection error: %s"),*Error); });
    Socket->OnClosed().AddWeakLambda(this, [this](int32 Code, const FString& Reason, bool Clean) {
        // Application close codes from src/server/protocol.ts. Refusals that retrying cannot fix
        // return to the sign-in screen with the server's own explanation.
        if(Code==4001||Code==4003||Code==4009||Code==4010||Code==4404) RequireSignIn(Reason, Code==4404);
        else if(Code==4000) RequireSignIn(TEXT("This account signed in from another client. Continue here to take over."));
        else if(Code==4503) { Status=Reason; RetryDelay=15; }
        else if(Code==4029) { Status=Reason; RetryDelay=30; }
        else { Status = TEXT("Disconnected - reconnecting"); RetryDelay=3; } bControls = false; bTransportConnected=false; UE_LOG(LogTemp,Warning,TEXT("TV_BRIDGE closed code=%d clean=%d reason=%s"),Code,Clean,*Reason); });
    Socket->OnMessage().AddWeakLambda(this, [this](const FString& Message) { Receive(Message); });
    Socket->Connect();
}
void UTVBridgeSubsystem::Tick(float Dt) {
    UpdateInteractionFocus();UpdatePlayerShell();
    if(FPlatformTime::Seconds()-ControlTraceAt>=.1){ControlTraceAt=FPlatformTime::Seconds();if(ControlTrace.Num()>=120)ControlTrace.RemoveAt(0);ControlTrace.Add(MakeShared<FJsonValueObject>(ControlState()));}
    if(CombatCorrectionStartedAt>=0&&RenderCorrection.Size()<.1){TVSample(CombatCorrectionSettleSamples,(FPlatformTime::Seconds()-CombatCorrectionStartedAt)*1000);CombatCorrectionStartedAt=-1;}
    SinceSnapshot = bCanonicalReady ? FPlatformTime::Seconds()-LastSnapshotReceived : 100; RetryClock += Dt;
    ResultClock += Dt; if (ResultClock > 2.5f && !LastResult.IsEmpty()) LastResult.Empty();
    UpdateSignIn();
    if ((!Socket || !Socket->IsConnected()) && RetryClock > RetryDelay && !bSignInRequired) { RetryClock = 0; Connect(); }
    // Death is permanent. After a moment to see it, offer a new character (the old one stays dead).
    if(ClientConfig.IsAlpha()&&CanonicalRestriction==TEXT("Dead")) { if(DeadSince<0) DeadSince=FPlatformTime::Seconds(); else if(FPlatformTime::Seconds()-DeadSince>6&&!bSignInRequired) { RequireSignIn(FString::Printf(TEXT("%s has died. Death is permanent in this world; you may begin a new life."),*CharacterName),true); if(Socket) Socket->Close(1000,TEXT("character died")); } } else DeadSince=-1;
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
    if(!InteractionEpoch.IsEmpty()&&(Type==TEXT("attack")||Type==TEXT("interact")||Type==TEXT("container_transfer")||Type==TEXT("defend")||Type==TEXT("cancel"))) {
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
void UTVBridgeSubsystem::SetGuard(bool Held){auto M=MakeShared<FJsonObject>();M->SetStringField(TEXT("type"),TEXT("guard"));M->SetBoolField(TEXT("held"),Held);SendCommand(M);}
void UTVBridgeSubsystem::SendCombat(const FString& Kind,int32 Side,const FString& Trajectory,double CallbackAt,const FVector& Direction,bool bHeavy) {
    const double Begin=CallbackAt>0?CallbackAt:FPlatformTime::Seconds();
    if(!HasPrediction()||HasModalScreen())return;
    CombatInputCallbackAt=Begin;
    BufferedCombat.Reset(); // newest press replaces the one pending follow-up
    auto M=MakeShared<FJsonObject>();M->SetStringField(TEXT("type"),Kind==TEXT("attack")?TEXT("attack"):TEXT("defend"));
    if(Kind==TEXT("attack")){M->SetStringField(TEXT("trajectory"),Trajectory);M->SetStringField(TEXT("weight"),bHeavy?TEXT("heavy"):TEXT("light"));const FString Target=LockedTargetBody(Cast<ATVCharacter>(UGameplayStatics::GetPlayerCharacter(GetWorld(),0)));if(!Target.IsEmpty())M->SetStringField(TEXT("targetBodyId"),Target);}
    else {M->SetStringField(TEXT("kind"),Kind);M->SetNumberField(TEXT("side"),Side);}
    if(!Direction.IsNearlyZero()) {auto D=MakeShared<FJsonObject>();D->SetNumberField(TEXT("x"),Direction.X);D->SetNumberField(TEXT("z"),Direction.Z);M->SetObjectField(TEXT("direction"),D);}
    FBufferedCombat Input;Input.Kind=Kind;Input.Side=Side;Input.Trajectory=Trajectory;Input.Direction=Direction;Input.bHeavy=bHeavy;
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
    if(Input.Kind==TEXT("crouch")){PredictedCombat=FTVLiveCombat();CombatAge=0;return;}
    if(Predicted.Crouch>.001){
        if(!FTVInteractionPrediction::PostureFits(Predicted,0,[this](int X,int Z){return PredictionColumn(X,Z);})){LastResult=TEXT("Standing blocked");return;}
        bCrouchHeld=false;PredictedCombat=FTVLiveCombat::Predict(TEXT("duck"),Predicted.Yaw,1,TEXT("posture-exit"));
        PredictedCombat.Definition=TEXT("crouch_exit");PredictedCombat.ActiveAt=0;PredictedCombat.RecoveryAt=PredictedCombat.CompleteAt=TVInteractionSpec::crouchExitSeconds;
        CombatAge=0;auto Queued=Input;Queued.bBuffered=true;BufferedCombat=Queued;return;
    }
    const FString Previous=PredictedCombat.Variant;
    const bool PriorAttack=PredictedCombat.IsAttack();
    const FString PreviousMove=PriorAttack?PredictedCombat.MoveId:PredictedCombat.PriorStrike;
    const bool Chain=(PriorAttack||!PreviousMove.IsEmpty())&&PredictedCombat.Outcome!=TEXT("interrupted")&&PredictedCombat.Outcome!=TEXT("cancelled")&&CombatAge<=PredictedCombat.CompleteAt-PredictedCombat.StartedAt+.3;
    PredictedCombat=FTVLiveCombat::Predict(Input.Kind,Predicted.Yaw,Input.Side,Input.CommandId);
    PredictedCombat.ActorBodyId=InteractionBody;PredictedCombat.Trajectory=Input.Trajectory;
    PredictedCombat.Variant=Input.Trajectory==TEXT("low")?TEXT("kick"):Chain&&Previous==TEXT("direct")?TEXT("hook"):TEXT("direct");
    if(Input.Kind==TEXT("attack")){
        PredictedCombat.MoveId=Input.Trajectory==TEXT("low")?(bArena&&Chain&&PreviousMove==TEXT("front_kick")?TEXT("round_kick"):TEXT("front_kick")):(Chain&&(PreviousMove==TEXT("jab")||PreviousMove.IsEmpty()&&Previous==TEXT("direct"))?TEXT("cross"):TEXT("jab"));
        const auto& M=TVCombatRepertoire::Move(PredictedCombat.MoveId);PredictedCombat.Variant=M.Variant;PredictedCombat.ActiveAt=M.preparation;PredictedCombat.RecoveryAt=M.preparation+M.active;PredictedCombat.CompleteAt=PredictedCombat.RecoveryAt+M.recovery;
    }
    if(Input.bHeavy&&Input.Kind==TEXT("attack")){
        const double Prep=PredictedCombat.ActiveAt*TVInteractionSpec::heavyPreparationMultiplier,Active=PredictedCombat.RecoveryAt-PredictedCombat.ActiveAt,Recovery=(PredictedCombat.CompleteAt-PredictedCombat.RecoveryAt)*TVInteractionSpec::heavyRecoveryMultiplier;
        PredictedCombat.ActiveAt=Prep;PredictedCombat.RecoveryAt=Prep+Active;PredictedCombat.CompleteAt=Prep+Active+Recovery;PredictedCombat.Definition+=TEXT(":heavy");
    }
    if(Input.Kind!=TEXT("attack")&&Input.Kind!=TEXT("duck")&&PriorAttack&&Chain)PredictedCombat.PriorStrike=PreviousMove;
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
    Out->SetObjectField(TEXT("control"),ControlState());Out->SetArrayField(TEXT("controlTrace"),ControlTrace);
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
void UTVBridgeSubsystem::PredictMovement(float Dt,const FVector& Direction,bool bSprint,TOptional<double> Facing) {
    const double Begin=FPlatformTime::Seconds();
    if(!HasPrediction()||!Confirmed.bEligible||Begin-LastLocalStateAt>TVInteractionSpec::inputHorizonSeconds) {PredictionAccumulator=0;PredictionVelocity=FVector::ZeroVector;return;}
    PredictionAccumulator+=FMath::Min(static_cast<double>(Dt),.1);
    const FVector Before=Predicted.Position;
    const FTVMovementInput Input{Direction.X,Direction.Y,bSprint,Facing,bCrouchHeld};
    int32 Count=0;
    while(PredictionAccumulator+1e-9>=TVInteractionSpec::stepSeconds&&Count<6&&PendingMovement.Num()<15) {
        ++Count;
        PredictionAccumulator-=TVInteractionSpec::stepSeconds;
        AdvanceCombatBuffer();
        const double SampleAge=CombatAge;
        if(FMath::Abs(Input.X)+FMath::Abs(Input.Z)>.01&&PredictedCombat.Locked(CombatAge)&&CombatAge>=PredictedCombat.TransitionAge(TEXT("move"))){
            PredictedCombat.CompleteAt=PredictedCombat.StartedAt+CombatAge;
            if(auto* C=Bodies.FindRef(InteractionBody).Get())C->CombatPresentation->ObserveAction(PredictedCombat,CombatAge);
        }
        if(PredictedCombat.Locked(CombatAge)){Predicted=PredictedCombat.Step(Predicted,CombatAge,TVInteractionSpec::stepSeconds,[this](int32 X,int32 Z){return PredictionColumn(X,Z);});CombatAge+=TVInteractionSpec::stepSeconds;}
        else Predicted=FTVInteractionPrediction::Step(Predicted,Input,TVInteractionSpec::stepSeconds,[this](int32 X,int32 Z){return PredictionColumn(X,Z);});
        Predicted=FTVInteractionPrediction::Posture(Predicted,bCrouchHeld&&!BufferedCombat.IsSet(),TVInteractionSpec::stepSeconds,[this](int32 X,int32 Z){return PredictionColumn(X,Z);});
        auto C=MakeShared<FJsonObject>();C->SetStringField(TEXT("type"),TEXT("move"));C->SetNumberField(TEXT("x"),Input.X);C->SetNumberField(TEXT("z"),Input.Z);C->SetBoolField(TEXT("sprint"),Input.bSprint);if(Input.Facing.IsSet())C->SetNumberField(TEXT("facing"),Input.Facing.GetValue());C->SetBoolField(TEXT("crouch"),Input.bCrouch);
        const int32 Seq=SendCommand(C);if(Seq>=0)PendingMovement.Add({Seq,Input,PredictedCombat,SampleAge});
        ++PredictionCount;
    }
    if(FTVPredictionVelocitySample::Resolve(Before,Predicted.Position,Count*TVInteractionSpec::stepSeconds,PredictionVelocity))
        PredictionVelocity=FVector(PredictionVelocity.X,PredictionVelocity.Z,PredictionVelocity.Y);
    // Backpressure is not a physical stop. Keep the last executed motion sample
    // until another step resolves a stop/collision or authority becomes stale.
    // In particular, filling the queue must not erase this frame's displacement.
    if(PendingMovement.Num()>=15) PredictionAccumulator=0;
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
    Confirmed.Yaw=State->GetNumberField(TEXT("yaw"));Confirmed.Speed=State->GetNumberField(TEXT("speed"));Confirmed.bEligible=State->GetBoolField(TEXT("eligible"));State->TryGetNumberField(TEXT("crouch"),Confirmed.Crouch);if(!Confirmed.bEligible)bCrouchHeld=false;
    const TSharedPtr<FJsonObject>* Practice;
    if(M->TryGetObjectField(TEXT("practice"),Practice)){
        const FString Profile=(*Practice)->GetStringField(TEXT("profile"));bPracticeRecovery=Profile==TEXT("Practice Recovery");
        PracticeStatus=FString::Printf(TEXT("SCRIPTED PRACTICE: %s | %s | %s"),*(*Practice)->GetStringField(TEXT("mode")),*(*Practice)->GetStringField(TEXT("status")),*Profile);
        PracticeLast=FString::Printf(TEXT("%s | fatigue you %.0f%% / target %.0f%% | quiet recovery %.1f%%/s | ARENA TEST REPERTOIRE"),*(*Practice)->GetStringField(TEXT("lastOutcome")),(*Practice)->GetNumberField(TEXT("fatigue"))*100,(*Practice)->GetNumberField(TEXT("opponentFatigue"))*100,(*Practice)->GetNumberField(TEXT("recoveryPerSecond"))*100);
    }
    const int32 Ack=M->GetIntegerField(TEXT("ack"));LastMovementAck=Ack;PendingMovement.RemoveAll([Ack](const auto& P){return P.Sequence<=Ack;});
    bool AuthorityHeld=false;if(M->TryGetBoolField(TEXT("crouchHeld"),AuthorityHeld)&&Ack>=CrouchSequence&&!AuthorityHeld)bCrouchHeld=false;
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
        Predicted=FTVInteractionPrediction::Posture(Predicted,P.Input.bCrouch&&(AuthorityHeld||CrouchSequence>Ack)&&!BufferedCombat.IsSet(),TVInteractionSpec::stepSeconds,[this](int32 X,int32 Z){return PredictionColumn(X,Z);});
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
    if(HasModalScreen()||!IsLive()||FocusedActionId.IsEmpty())return;
    // Prompt, exact highlighted bounds and submitted ID share this one immutable selection.
    if(FocusedKind==TEXT("person"))SendIntent(TEXT("talk"),FocusedTargetId);
    else {if(FocusedKind==TEXT("container")&&FocusedActionId.StartsWith(TEXT("open:")))PendingOpenContainer=FocusedTargetId;
        auto M=MakeShared<FJsonObject>();M->SetStringField(TEXT("type"),TEXT("interact"));M->SetStringField(TEXT("interactionId"),FocusedActionId);Send(M);}
}
void UTVBridgeSubsystem::ClearBufferedInput() {
    BufferedCombat.Reset();
    bCrouchHeld=false;
}
void UTVBridgeSubsystem::ToggleInventory() {
    if(!IsLive()||!PlayerShell)return;
    if(HasModalScreen()){UIBack();return;}
    if(OpenContainerId.IsEmpty())PlayerShell->OpenInventory();else PlayerShell->OpenContainer();
}
void UTVBridgeSubsystem::TogglePause() {
    if(!PlayerShell)return;if(HasModalScreen())UIBack();else PlayerShell->OpenMenu();
}
void UTVBridgeSubsystem::UIBack() {
    if(bMechanismsOpen){bMechanismsOpen=false;return;}
    if(PlayerShell&&PlayerShell->HasModalScreen()){if(bDialogueOpen)CloseDialogue();PlayerShell->CloseTop();return;}
    if(PlayerShell)PlayerShell->OpenMenu();
}
void UTVBridgeSubsystem::UIMove(int32 Delta) {
    if(!bInventoryOpen)return;const int32 Count=InventoryItemIds.Num()+ContainerItemIds.Num();
    if(Count>0)UISelection=(UISelection+Delta%Count+Count)%Count;
}
void UTVBridgeSubsystem::UIConfirm() {
    if(!bInventoryOpen||OpenContainerId.IsEmpty())return;
    FString Item,Direction;
    if(InventoryItemIds.IsValidIndex(UISelection)){Item=InventoryItemIds[UISelection];Direction=TEXT("into");}
    else {const int32 Index=UISelection-InventoryItemIds.Num();if(ContainerItemIds.IsValidIndex(Index)){Item=ContainerItemIds[Index];Direction=TEXT("out");}}
    if(Item.IsEmpty())return;
    auto M=MakeShared<FJsonObject>();M->SetStringField(TEXT("type"),TEXT("container_transfer"));M->SetStringField(TEXT("containerId"),OpenContainerId);M->SetStringField(TEXT("itemId"),Item);M->SetStringField(TEXT("direction"),Direction);Send(M);
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
                if(BufferedCombat.IsSet()&&BufferedCombat->Sequence==Seq)BufferedCombat.Reset();if(Seq==PendingFeedbackSequence)bCrouchHeld=false;
                if(Seq==CombatCommandSequence){if(auto* C=Bodies.FindRef(InteractionBody).Get())C->CombatPresentation->RejectAction(PredictedCombat.CommandId);PredictedCombat=FTVLiveCombat();}
                LastResult=ResultText(M->GetStringField(TEXT("result")));ResultClock=0;}
            else if(Seq==PendingFeedbackSequence){LastResult=TEXT("Confirmed");ResultClock=0;PendingFeedbackSequence=-1;}
        }
        return;
    }
    if(Type==TEXT("hello")) {
        const TSharedPtr<FJsonObject>* Binding;
        if(M->TryGetObjectField(TEXT("interaction"),Binding)) {
            if((*Binding)->GetStringField(TEXT("specRevision"))!=TVInteractionSpec::revision||(*Binding)->GetStringField(TEXT("specHash"))!=TVInteractionSpec::hash){ProtocolError(TEXT("Interaction specification mismatch"));return;}
            InteractionEpoch=(*Binding)->GetStringField(TEXT("epoch"));InteractionController=(*Binding)->GetStringField(TEXT("controllerId"));InteractionBody=(*Binding)->GetStringField(TEXT("bodyId"));
            PendingMovement.Empty();CommandSentAt.Empty();BufferedCombat.Reset();bCrouchHeld=false;LastCombatStartAt=0;PredictedCombat=FTVLiveCombat();CombatAge=0;CombatCommandSequence=-1;bPredictionReady=false;PredictionAccumulator=0;PredictionVelocity=FVector::ZeroVector;LastConfirmedTick=-1;
        }
    }
    if (Type == TEXT("hello")) {
        const TSharedPtr<FJsonObject>* Character; if(M->TryGetObjectField(TEXT("character"),Character)) { (*Character)->TryGetStringField(TEXT("name"),CharacterName); bool bCreated=false; (*Character)->TryGetBoolField(TEXT("created"),bCreated); if(ClientConfig.IsAlpha()) { if(bCreated) ClientConfig.Character=TEXT("auto"); ClientConfig.Save(); } }
        M->TryGetStringField(TEXT("worldId"),WorldId); M->TryGetStringField(TEXT("release"),ServerRelease); RetryDelay=3;
        const TSharedPtr<FJsonObject>* Maint; MaintenanceMessage.Empty(); if(M->TryGetObjectField(TEXT("maintenance"),Maint)&&Maint&&Maint->IsValid()) (*Maint)->TryGetStringField(TEXT("message"),MaintenanceMessage);
        if(!CharacterName.IsEmpty()) Status=FString::Printf(TEXT("%s - %s"),*CharacterName,*ServerRelease);
    }
    if (Type == TEXT("maintenance")) { FString Msg; M->TryGetStringField(TEXT("message"),Msg); const double InMs=M->GetNumberField(TEXT("inMs")); MaintenanceMessage=FString::Printf(TEXT("Maintenance in %.0f s: %s"),InMs/1000,*Msg); return; }
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
        if(!Delta.IsNearlyZero()) {for(auto& Pair:Bodies) Pair.Value->RebasePresentation(Delta);for(auto& Pair:WildlifeBodies)Pair.Value->RebasePresentation(Delta);}
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
        LastResult = ResultText(Result);
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
    InventoryItemIds.Empty();InventoryItemLabels.Empty();ContainerItemIds.Empty();ContainerItemLabels.Empty();
    const bool HadContainer=!OpenContainerId.IsEmpty();OpenContainerId.Empty();OpenContainerName.Empty();
    const TSharedPtr<FJsonObject>* Container;
    if(M->TryGetObjectField(TEXT("container"),Container)&&Container&&Container->IsValid()) {
        (*Container)->TryGetStringField(TEXT("id"),OpenContainerId);(*Container)->TryGetStringField(TEXT("name"),OpenContainerName);
        const TArray<TSharedPtr<FJsonValue>>* Contents;
        if((*Container)->TryGetArrayField(TEXT("items"),Contents))for(const auto& Value:*Contents){const auto I=Value->AsObject();if(!I)continue;ContainerItemIds.Add(I->GetStringField(TEXT("id")));ContainerItemLabels.Add(FString::Printf(TEXT("%s  x%.0f"),*I->GetStringField(TEXT("name")),I->GetNumberField(TEXT("quantity"))));}
    } else if(HadContainer) bInventoryOpen=false;
    const TArray<TSharedPtr<FJsonValue>>* Interactions;
    if (M->TryGetArrayField(TEXT("interactions"), Interactions)) for (const auto& V : *Interactions) {
        const auto A = V->AsObject(); if (!A) continue;
        const FString Slot = A->GetStringField(TEXT("slot"));
        FString& Id = Slot == TEXT("consume") ? ConsumeInteraction : Slot == TEXT("drop") ? DropInteraction : NearbyInteraction;
        FString& Prompt = Slot == TEXT("consume") ? ConsumePrompt : Slot == TEXT("drop") ? DropPrompt : NearbyPrompt;
        if (Id.IsEmpty()) { Id = A->GetStringField(TEXT("id")); Prompt = A->GetStringField(TEXT("label")); }
    }
    FocusTargets.Reset();const TArray<TSharedPtr<FJsonValue>>* Targets;
    if(M->TryGetArrayField(TEXT("interactionTargets"),Targets))for(const auto& V:*Targets){const auto T=V->AsObject();if(!T)continue;const auto P=T->GetObjectField(TEXT("pos"));
        FocusTargets.Add({T->GetStringField(TEXT("targetId")),T->GetStringField(TEXT("actionId")),T->GetStringField(TEXT("kind")),T->GetStringField(TEXT("label")),FVector(P->GetNumberField(TEXT("x")),P->GetNumberField(TEXT("y")),P->GetNumberField(TEXT("z")))});}
    const TSharedPtr<FJsonObject>* Journal;
    if(M->TryGetObjectField(TEXT("journal"),Journal)&&Journal&&Journal->IsValid()) {
        // The person's own commitments, wounds and standing - never anyone else's private state.
        TArray<FString> Parts; Parts.Add(FString::Printf(TEXT("Stage: %s"),*(*Journal)->GetStringField(TEXT("stage"))));
        for(const auto& V:(*Journal)->GetArrayField(TEXT("commitments"))){const auto J=V->AsObject();FString Who;J->TryGetStringField(TEXT("requester"),Who);Parts.Add(FString::Printf(TEXT("Promised: %s for %s (%.0f silver)"),*J->GetStringField(TEXT("kind")),Who.IsEmpty()?TEXT("no one in particular"):*Who,J->GetNumberField(TEXT("reward"))));}
        for(const auto& V:(*Journal)->GetArrayField(TEXT("injuries"))){const auto J=V->AsObject();Parts.Add(FString::Printf(TEXT("Wound: %s %s"),*J->GetStringField(TEXT("severity")),*J->GetStringField(TEXT("region"))));}
        // Living Alpha progression: one's own foundations with progress toward the next point,
        // veil strain, and what still stands between this person and Iron.
        const TArray<TSharedPtr<FJsonValue>>* Foundations=nullptr; TArray<FString> F;
        if((*Journal)->TryGetArrayField(TEXT("foundations"),Foundations)) for(const auto& V:*Foundations){const auto J=V->AsObject();if(!J)continue;
            F.Add(FString::Printf(TEXT("%s %d (%d%%)"),*J->GetStringField(TEXT("id")).Left(3).ToUpper(),static_cast<int32>(J->GetNumberField(TEXT("value"))),FMath::RoundToInt(J->GetNumberField(TEXT("progress"))*100)));}
        FString Progression=F.IsEmpty()?FString():FString::Join(F,TEXT("  "));
        const TSharedPtr<FJsonObject>* Veil=nullptr;
        if((*Journal)->TryGetObjectField(TEXT("veil"),Veil)&&Veil&&Veil->IsValid()) Progression+=FString::Printf(TEXT("   |   Veil strain %.0f%%"),(*Veil)->GetNumberField(TEXT("strain"))*100);
        const TSharedPtr<FJsonObject>* Advancement=nullptr;
        if((*Journal)->TryGetObjectField(TEXT("advancement"),Advancement)&&Advancement&&Advancement->IsValid()){
            const TSharedPtr<FJsonObject>* Path=nullptr; FString PathSkill;
            if((*Advancement)->TryGetObjectField(TEXT("path"),Path)&&Path&&Path->IsValid()) PathSkill=(*Path)->GetStringField(TEXT("skill"));
            if((*Advancement)->GetBoolField(TEXT("eligible"))) Progression+=FString::Printf(TEXT("   |   Iron breakthrough possible through %s — open Journal"),*PathSkill);
            else { const TArray<TSharedPtr<FJsonValue>>* Remaining=nullptr; TArray<FString> R;
                if((*Advancement)->TryGetArrayField(TEXT("remaining"),Remaining)) for(int32 i=0;i<Remaining->Num();++i) R.Add((*Remaining)[i]->AsString());
                if(!R.IsEmpty()) Progression+=FString::Printf(TEXT("   |   Toward Iron%s: %s"),PathSkill.IsEmpty()?TEXT(""):*(TEXT(" (")+PathSkill+TEXT(")")),*FString::Join(R,TEXT("; "))); }
        }
        const TArray<TSharedPtr<FJsonValue>>* Practice=nullptr;double Required=0;
        if((*Journal)->TryGetNumberField(TEXT("practiceHoursRequired"),Required)&&(*Journal)->TryGetArrayField(TEXT("practice"),Practice))for(const auto& V:*Practice){const auto J=V->AsObject();if(J)Parts.Add(FString::Printf(TEXT("%s: %.2f / %.0f meaningful practice hours, %s, evidence across %.0f days"),*J->GetStringField(TEXT("skill")),J->GetNumberField(TEXT("hours")),Required,*J->GetStringField(TEXT("level")),J->GetNumberField(TEXT("days"))));}
        const TArray<TSharedPtr<FJsonValue>>* Techniques=nullptr;
        if((*Journal)->TryGetArrayField(TEXT("techniqueHistory"),Techniques))for(const auto& V:*Techniques){const auto J=V->AsObject();if(!J)continue;FString Teacher;J->TryGetStringField(TEXT("teacher"),Teacher);Parts.Add(FString::Printf(TEXT("Technique: %s — %s%s"),*J->GetStringField(TEXT("name")),*J->GetStringField(TEXT("method")),Teacher.IsEmpty()?TEXT(""):*(TEXT(" by ")+Teacher)));}
        JournalSummary=FString::Join(Parts,TEXT("   |   "))+(Progression.IsEmpty()?FString():TEXT("\n")+Progression);
    }
    const TSharedPtr<FJsonObject>* Mobility;
    if(M->TryGetObjectField(TEXT("mobility"),Mobility)) {CanonicalRestriction=(*Mobility)->GetStringField(TEXT("restriction"));
        MobilitySummary=FString::Printf(TEXT("Fatigue %.0f%% | movement %.0f%% | weighed load %.1f / safe carry %.1f kg%s"),(*Mobility)->GetNumberField(TEXT("fatigue"))*100,(*Mobility)->GetNumberField(TEXT("speedMultiplier"))*100,(*Mobility)->GetNumberField(TEXT("knownLoadKg")),(*Mobility)->GetNumberField(TEXT("safeCarryKg")),(*Mobility)->GetNumberField(TEXT("unweighedStacks"))>0?TEXT(" (+ unweighed items)"):TEXT(""));}
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
            PlayerVitals = FString::Printf(TEXT("%s%sHunger %.0f%%   Thirst %.0f%%   %.0f silver"), *(DangerCue.IsEmpty()?FString():DangerCue+TEXT("\n")), *(MaintenanceMessage.IsEmpty()?FString():MaintenanceMessage+TEXT("\n")), Needs->GetNumberField(TEXT("hunger")) * 100, Needs->GetNumberField(TEXT("thirst")) * 100, D->GetNumberField(TEXT("wealth")));
            TArray<FString> Items;
            for (const auto& Item : D->GetArrayField(TEXT("inventory"))) {
                const auto I = Item->AsObject(); const double Qty = I->GetNumberField(TEXT("quantity"));
                if (Qty > 0) {const FString Label=FString::Printf(TEXT("%s  x%.0f"), *I->GetStringField(TEXT("name")), Qty);Items.Add(Label);InventoryItemIds.Add(I->GetStringField(TEXT("id")));InventoryItemLabels.Add(Label);}
            }
            CarriedSummary = Items.IsEmpty() ? TEXT("Empty hands") : FString::Join(Items, TEXT("  |  "));
        }
    }
    const int32 UIItems=InventoryItemIds.Num()+ContainerItemIds.Num();UISelection=UIItems?FMath::Clamp(UISelection,0,UIItems-1):0;
    TSet<FString> PresentWildlife;
    const TSharedPtr<FJsonObject>* WildlifeFrame=nullptr;
    const TArray<TSharedPtr<FJsonValue>>* WildlifeRows=nullptr;
    DangerCue.Empty();
    if(M->TryGetObjectField(TEXT("wildlife"),WildlifeFrame)&&(*WildlifeFrame)->TryGetArrayField(TEXT("bodies"),WildlifeRows)) {
        for(const auto& Value:*WildlifeRows) {
            const auto D=Value->AsObject();if(!D)continue;FString Id;if(!D->TryGetStringField(TEXT("bodyId"),Id)||Id.IsEmpty())continue;
            // A readable cue for behaviour aimed at you: what it is doing, and what that asks of you.
            bool AtMe=false;FString Defense;D->TryGetBoolField(TEXT("defenseAtViewer"),AtMe);D->TryGetStringField(TEXT("defense"),Defense);
            if(AtMe&&DangerCue.IsEmpty()){FString Species;D->TryGetStringField(TEXT("speciesId"),Species);Species=Species.Replace(TEXT("_"),TEXT(" "));
                DangerCue=Defense==TEXT("warn")?FString::Printf(TEXT("A %s is bristling at you - back away, or hush it (H)."),*Species)
                    :Defense==TEXT("charge")?FString::Printf(TEXT("The %s is charging!"),*Species)
                    :Defense==TEXT("strike")?FString::Printf(TEXT("The %s lunges - step aside now (dodge)!"),*Species)
                    :Defense==TEXT("recover")?FString::Printf(TEXT("The %s is recovering - strike low now."),*Species):FString();}
            ATVWildlifePresentation* Animal=WildlifeBodies.Contains(Id)?WildlifeBodies[Id].Get():nullptr;const bool First=!IsValid(Animal);
            if(First){FActorSpawnParameters P;P.SpawnCollisionHandlingOverride=ESpawnActorCollisionHandlingMethod::AlwaysSpawn;Animal=GetWorld()->SpawnActor<ATVWildlifePresentation>(FVector::ZeroVector,FRotator::ZeroRotator,P);}
            if(!Animal||!Animal->Project(D,CanonicalOrigin,UnitsPerMetre,First)){if(First&&IsValid(Animal))Animal->Destroy();continue;}
            PresentWildlife.Add(Id);if(First)WildlifeBodies.Add(Id,Animal);
        }
    }
    TArray<FString> RemovedWildlife;
    for(const auto& Pair:WildlifeBodies)if(!PresentWildlife.Contains(Pair.Key)){if(IsValid(Pair.Value))Pair.Value->Destroy();RemovedWildlife.Add(Pair.Key);}
    for(const auto& Id:RemovedWildlife)WildlifeBodies.Remove(Id);
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
    Status = FString::Printf(TEXT("LIVE  |  %d visible people  |  %d wildlife  |  t %.1fs%s"), FMath::Max(0, Bodies.Num() - 1),WildlifeBodies.Num(), ServerTick, bControls ? TEXT("") : TEXT("  |  observer connection"));
}
ATVCharacter* UTVBridgeSubsystem::Selected() const { const auto* C = Bodies.Find(SelectedBody); return C ? C->Get() : nullptr; }
bool UTVBridgeSubsystem::SelectedTargetPosition(FVector& Position) const {
    AActor* Target=Bodies.FindRef(SelectedBody).Get();
    if(auto* Human=Cast<ATVCharacter>(Target);Human&&(Human->bIncapacitated||Human->bDead))return false;
    if(!Target){auto* Animal=WildlifeBodies.FindRef(SelectedBody).Get();if(Animal&&Animal->bAlive)Target=Animal;}
    const auto* Player=UGameplayStatics::GetPlayerCharacter(GetWorld(),0);
    if(!IsValid(Target)||!Player||FVector::DistSquared(Player->GetActorLocation(),Target->GetActorLocation())>FMath::Square(1800.f))return false;
    Position=Target->GetActorLocation();return true;
}
FString UTVBridgeSubsystem::LockedTargetBody(const ATVCharacter* Player) const {
    if(!Player||!Player->bTargetLocked)return {};
    AActor* Target=Bodies.FindRef(SelectedBody).Get();
    if(auto* Human=Cast<ATVCharacter>(Target);Human&&(Human->bIncapacitated||Human->bDead))return {};
    if(!Target){auto* Animal=WildlifeBodies.FindRef(SelectedBody).Get();if(Animal&&Animal->bAlive)Target=Animal;}
    return IsValid(Target)&&FVector::DistSquared(Player->GetActorLocation(),Target->GetActorLocation())<=FMath::Square(1800.f)?SelectedBody:FString();
}
FString UTVBridgeSubsystem::AbilityTargetBody(const ATVCharacter* Player) const {
    if(!Player)return {};
    const FString Locked=LockedTargetBody(Player);if(!Locked.IsEmpty())return Locked;
    FString Target;double Best=FMath::Square(1000.0);
    const auto Consider=[&](const FString& Id,AActor* Actor){
        if(!IsValid(Actor)||Actor==Player)return;
        const FVector D=Actor->GetActorLocation()-Player->GetActorLocation();const double D2=D.SizeSquared2D();
        if(D2>=Best||FVector::DotProduct(D.GetSafeNormal2D(),Player->GetActorForwardVector().GetSafeNormal2D())<=.2)return;
        FHitResult Hit;FCollisionQueryParams Params;Params.AddIgnoredActor(Player);Params.AddIgnoredActor(Actor);
        if(GetWorld()->LineTraceSingleByChannel(Hit,Player->GetActorLocation()+FVector(0,0,50),Actor->GetActorLocation()+FVector(0,0,40),ECC_Visibility,Params))return;
        Best=D2;Target=Id;
    };
    for(const auto& Pair:Bodies)if(IsValid(Pair.Value)&&!Pair.Value->bIncapacitated&&!Pair.Value->bDead)Consider(Pair.Key,Pair.Value);
    for(const auto& Pair:WildlifeBodies)if(IsValid(Pair.Value)&&Pair.Value->bAlive)Consider(Pair.Key,Pair.Value);
    return Target;
}
void UTVBridgeSubsystem::CycleTarget() {
    auto* P=UGameplayStatics::GetPlayerCharacter(GetWorld(),0);if(!P)return;
    TArray<TPair<FString,AActor*>> Candidates;
    const auto Add=[&](const FString& Id,AActor* Actor){
        if(!IsValid(Actor)||FVector::DistSquared(P->GetActorLocation(),Actor->GetActorLocation())>FMath::Square(1800.f))return;
        FHitResult Hit;FCollisionQueryParams Params;Params.AddIgnoredActor(P);Params.AddIgnoredActor(Actor);
        if(!GetWorld()->LineTraceSingleByChannel(Hit,P->GetActorLocation()+FVector(0,0,50),Actor->GetActorLocation()+FVector(0,0,40),ECC_Visibility,Params))Candidates.Emplace(Id,Actor);
    };
    for(const auto& Pair:Bodies)if(IsValid(Pair.Value)&&!Pair.Value->bCanonicalPlayer&&!Pair.Value->bIncapacitated)Add(Pair.Key,Pair.Value);
    for(const auto& Pair:WildlifeBodies)if(IsValid(Pair.Value)&&Pair.Value->bAlive)Add(Pair.Key,Pair.Value);
    Candidates.Sort([P](const auto& A,const auto& B){const float DA=FVector::DistSquared(P->GetActorLocation(),A.Value->GetActorLocation()),DB=FVector::DistSquared(P->GetActorLocation(),B.Value->GetActorLocation());return DA==DB?A.Key<B.Key:DA<DB;});
    if(Candidates.IsEmpty()){SelectedBody.Empty();return;}
    const int32 Index=Candidates.IndexOfByPredicate([this](const auto& C){return C.Key==SelectedBody;});
    SelectedBody=Candidates[(Index+1)%Candidates.Num()].Key;
}

void UTVBridgeSubsystem::ToggleMechanisms() { bMechanismsOpen=!bMechanismsOpen; if(bMechanismsOpen) {CloseDialogue();bInventoryOpen=false;bPauseOpen=false;} }
void UTVBridgeSubsystem::ChooseMechanism(int32 Index) { if(!IsLive() || !MechanismIntents.IsValidIndex(Index)) return; auto M=MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"),TEXT("person_action")); M->SetObjectField(TEXT("intent"),MechanismIntents[Index]); Send(M); }
void UTVBridgeSubsystem::ToggleRest() {
    if(!IsLive()) return;
    auto Intent=MakeShared<FJsonObject>(); Intent->SetStringField(TEXT("kind"),CanonicalRestriction==TEXT("Sleeping")?TEXT("wake"):TEXT("rest"));
    auto M=MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"),TEXT("person_action")); M->SetObjectField(TEXT("intent"),Intent); Send(M);
    LastResult=CanonicalRestriction==TEXT("Sleeping")?TEXT("Getting up..."):TEXT("Resting. Use Rest in Abilities to get up."); ResultClock=0;
}
void UTVBridgeSubsystem::Hush() {
    if(!IsLive()) return;
    const FString Target=AbilityTargetBody(Cast<ATVCharacter>(UGameplayStatics::GetPlayerCharacter(GetWorld(),0)));
    if(Target.IsEmpty()) { LastResult=TEXT("No one and nothing close enough to hush."); ResultClock=0; return; }
    auto M=MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"),TEXT("hush")); M->SetStringField(TEXT("targetBodyId"),Target); Send(M);
}
void UTVBridgeSubsystem::PersonAction(const FString& Kind, const FString& Pending) {
    if(!IsLive()) return;
    auto Intent=MakeShared<FJsonObject>(); Intent->SetStringField(TEXT("kind"),Kind);
    auto M=MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"),TEXT("person_action")); M->SetObjectField(TEXT("intent"),Intent); Send(M);
    LastResult=Pending; ResultClock=0;
}
FString UTVBridgeSubsystem::ResultText(const FString& Code) {
    static const TMap<FString,FString> Text={
        {TEXT("out_of_reach"),TEXT("Too far to reach.")},{TEXT("no_target"),TEXT("Nothing in reach.")},{TEXT("cooldown"),TEXT("Still recovering.")},
        {TEXT("incapacitated"),TEXT("You cannot act right now.")},{TEXT("no_resource"),TEXT("Nothing here to gather.")},{TEXT("unavailable_resource"),TEXT("Nothing here to gather.")},
        {TEXT("missing_tool"),TEXT("You need a blade for that.")},{TEXT("too_tired"),TEXT("You are too tired.")},{TEXT("exhausted"),TEXT("You are exhausted.")},
        {TEXT("too_strained"),TEXT("Your veil strain is too high; rest first.")},{TEXT("unknown_technique"),TEXT("You do not know how to hush. Someone would have to teach you.")},
        {TEXT("resisted"),TEXT("It did not take - the hush failed.")},{TEXT("calmed"),TEXT("It went still.")},{TEXT("invalid_target"),TEXT("Nothing to hush there.")},
        {TEXT("insufficient_funds"),TEXT("You cannot afford it.")},{TEXT("unavailable_stock"),TEXT("None left.")},{TEXT("interaction_unavailable"),TEXT("You can't do that from here.")},
        {TEXT("not_carried"),TEXT("You are not carrying that.")},{TEXT("expired"),TEXT("Input arrived too late and was dropped.")},{TEXT("dead"),TEXT("You are dead.")},
        {TEXT("invalid_intent"),TEXT("You can't do that now.")},{TEXT("saved"),TEXT("Progress saved on the server.")},{TEXT("forbidden"),TEXT("Not permitted.")},
        {TEXT("use_command_protocol"),TEXT("Client out of date.")},{TEXT("weapon_unavailable"),TEXT("You no longer hold that weapon.")},{TEXT("standing_blocked"),TEXT("No room to stand.")},
    };
    const FString* T=Text.Find(Code); return T?*T:Code.Replace(TEXT("_"),TEXT(" "));
}
void UTVBridgeSubsystem::SaveWorld() { auto M=MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"),TEXT("save")); Send(M); }
void UTVBridgeSubsystem::RequestDeveloperInspection() { if(auto* T=Selected()) { auto M=MakeShared<FJsonObject>(); M->SetStringField(TEXT("type"),TEXT("debug_inspect")); M->SetStringField(TEXT("personId"),T->EntityId); Send(M); } }

void UTVBridgeSubsystem::SetPractice(const FString& Mode) {
    if(!bArena||!IsLive())return;
    BufferedCombat.Reset();if(Mode==TEXT("reset")){bCrouchHeld=false;PredictedCombat=FTVLiveCombat();CombatAge=0;LastCombatStartAt=0;PendingMovement.Empty();}
    auto M=MakeShared<FJsonObject>();M->SetStringField(TEXT("type"),TEXT("practice"));M->SetStringField(TEXT("mode"),Mode);PendingFeedbackSequence=SendCommand(M);
}

void UTVBridgeSubsystem::SetCrouch(bool Held){
 if(!HasPrediction())return;
 if(Held)CombatInputCallbackAt=FPlatformTime::Seconds();
 bCrouchHeld=Held;
 if(!Held&&BufferedCombat.IsSet()&&BufferedCombat->Kind==TEXT("crouch"))BufferedCombat.Reset();
 auto M=MakeShared<FJsonObject>();M->SetStringField(TEXT("type"),TEXT("crouch"));M->SetBoolField(TEXT("held"),Held);
 const int Seq=SendCommand(M);CrouchSequence=Seq;PendingFeedbackSequence=Seq;if(!Held)return;
 const double Wait=PredictedCombat.TransitionAge(TEXT("duck"))-CombatAge;
 if(Wait>TVInteractionSpec::combatBufferSeconds){bCrouchHeld=false;LastResult=TEXT("Committed - crouch closer to recovery");return;}
 if(Wait>0){FBufferedCombat I;I.Kind=TEXT("crouch");I.Sequence=Seq;I.CommandId=FString::Printf(TEXT("%s:%d"),*InteractionController,Seq);I.InputAt=FPlatformTime::Seconds();I.ExpiresAt=I.InputAt+TVInteractionSpec::combatBufferSeconds;I.bBuffered=true;BufferedCombat=I;}
 else {PredictedCombat=FTVLiveCombat();CombatAge=0;}
}
