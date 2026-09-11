#include "TVCombatPresentationComponent.h"
#include "TVCombatAnimInstance.h"
#include "TVCharacter.h"
#include "TVBridgeSubsystem.h"
#include "Animation/AnimSequence.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "ProceduralMeshComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Camera/CameraComponent.h"
#include "Camera/PlayerCameraManager.h"
#include "Kismet/GameplayStatics.h"
#include "Dom/JsonObject.h"

UTVCombatPresentationComponent::UTVCombatPresentationComponent() { PrimaryComponentTick.bCanEverTick=false; }
int32 UTVCombatPresentationComponent::LOD() const {
    const auto* Camera=UGameplayStatics::GetPlayerCameraManager(GetWorld(),0);
    const float Distance=Camera?FVector::Dist(Camera->GetCameraLocation(),GetOwner()->GetActorLocation()):0;
    return Distance>2500?2:Distance>1200?1:0;
}
void UTVCombatPresentationComponent::BeginPlay() {
    Super::BeginPlay();
    Idle=LoadObject<UAnimSequence>(nullptr,TEXT("/Game/Characters/Mannequins/Anims/Unarmed/MM_Idle"));
    for(const auto& P:FTVCombatChoreographer::Primitives())if(!Animations.Contains(P.AssetPath))Animations.Add(P.AssetPath,LoadObject<UAnimSequence>(nullptr,*P.AssetPath));
    if(auto* C=Cast<ATVCharacter>(GetOwner())){C->GetMesh()->SetAnimInstanceClass(UTVCombatAnimInstance::StaticClass());C->GetMesh()->SetAnimationMode(EAnimationMode::AnimationSingleNode);}
}
void UTVCombatPresentationComponent::ObserveAction(const FTVLiveCombat& Action,double AtAge) {
    const bool Same=bLive&&(Live.Id==Action.Id||(!Live.CommandId.IsEmpty()&&Live.CommandId==Action.CommandId));
    if(!Action.Running(AtAge)) {if(Same)Cancel();return;}
    if(Same) {
        // The owning prediction keeps its cursor; an applied receipt never plays startup twice.
        LiveAge=bOwningTimeline?FMath::Max(LiveAge,AtAge):AtAge;
        const bool NewContact=Live.ContactAt<0&&Action.ContactAt>=0;
        Live=Action;Current.Plan=Live.Plan(LOD());
        if(NewContact){LiveContactReceivedAt=GetWorld()->GetTimeSeconds();bContact=true;}
        return;
    }
    Cancel();bLive=true;bOwningTimeline=Action.bPredicted;Live=Action;LiveAge=FMath::Max(0.,AtAge);LiveContactReceivedAt=-1;
    FTVChoreographyRequest Request;Request.Event.ActorBodyId=Action.ActorBodyId;Request.Event.ActorYaw=Action.Facing;Request.Event.Outcome=TEXT("miss");Request.LOD=LOD();
    Queue.Add({Request,Action.Plan(LOD()),GetWorld()->GetTimeSeconds()});
    Present(0);
}
void UTVCombatPresentationComponent::RejectAction(const FString& CommandId){if(bLive&&Live.CommandId==CommandId)Cancel();}
void UTVCombatPresentationComponent::ContactReaction() {
    Cancel();FTVChoreographyRequest R;R.bReaction=true;R.LOD=LOD();R.Event.Outcome=TEXT("hit");R.Event.WeaponType=TEXT("unarmed");
    auto P=FTVCombatChoreographer::Plan(R);P.ContactAt=0;P.Anticipation=0;P.Strike=.05;P.Recovery=.35;P.Duration=.4;P.FX.HitStop=0;
    Enqueue(R,P,GetWorld()->GetTimeSeconds());Present(0);
}
int32 UTVCombatPresentationComponent::PendingAttacks() const { return Queue.FilterByPredicate([](const auto& R){return !R.Request.bReaction;}).Num(); }
int32 UTVCombatPresentationComponent::PendingHits() const { return Queue.FilterByPredicate([](const auto& R){return R.Request.bReaction;}).Num(); }
FString UTVCombatPresentationComponent::AnimationPath() const { return bActive?Current.Plan.Motion.AssetPath:FString(); }
void UTVCombatPresentationComponent::Enqueue(const FTVChoreographyRequest& Request,const FTVChoreographyPlan& Plan,double Start) {
    if (Queue.Num()>=32 || Start-GetWorld()->GetTimeSeconds()>8) { ++Dropped; return; }
    Queue.Add({Request,Plan,Start}); AvailableAt=Start+Plan.Duration+Plan.FX.HitStop+.02;
}
void UTVCombatPresentationComponent::Cancel() {
    Dropped+=Queue.Num(); Queue.Empty(); AvailableAt=0;
    if (auto* C=Cast<ATVCharacter>(GetOwner())) {
        if(bActive) { C->GetMesh()->SetRelativeLocation(BaseLocation); C->GetMesh()->SetRelativeRotation(BaseRotation); }
        C->Camera->SetRelativeLocation(FVector::ZeroVector);
    }
    if(Ribbon) Ribbon->ClearAllMeshSections(); if(Flash) Flash->SetVisibility(false);
    bActive=false; bLive=false;Live=FTVLiveCombat(); Trail.Empty(); Hold=0;
}
bool UTVCombatPresentationComponent::Present(float Dt) {
    auto* C=Cast<ATVCharacter>(GetOwner()); if(!C) return false;
    if (C->bIncapacitated) { Cancel(); return false; }
    if (!bActive && Queue.Num() && GetWorld()->GetTimeSeconds()>=Queue[0].StartsAt) {
        Current=Queue[0]; Queue.RemoveAt(0); Age=0; Hold=0; bContact=false; bActive=true; Trail.Empty();
        BaseLocation=C->GetMesh()->GetRelativeLocation(); BaseRotation=C->GetMesh()->GetRelativeRotation();
        LeftAnchor=C->GetActorTransform().InverseTransformPosition(C->GetMesh()->GetSocketLocation(TEXT("foot_l")));
        RightAnchor=C->GetActorTransform().InverseTransformPosition(C->GetMesh()->GetSocketLocation(TEXT("foot_r")));
        if (!Idle) Idle=LoadObject<UAnimSequence>(nullptr,TEXT("/Game/Characters/Mannequins/Anims/Unarmed/MM_Idle"));
        const FString Path=Current.Plan.Motion.AssetPath;
        if(!Animations.Contains(Path)) Animations.Add(Path,LoadObject<UAnimSequence>(nullptr,*Path));
        if (!Idle || !Animations.FindRef(Path)) { ++Dropped; bActive=false; return false; }
        C->GetMesh()->SetAnimInstanceClass(UTVCombatAnimInstance::StaticClass());
        auto* Anim=Cast<UTVCombatAnimInstance>(C->GetMesh()->GetAnimInstance());
        if(!Anim) { ++Dropped; bActive=false; return false; }
        Anim->Base=Idle; Anim->Motion=Animations.FindRef(Path);
        PlayedSequences.Add(Current.Request.Event.Seq); if(PlayedSequences.Num()>64) PlayedSequences.RemoveAt(0);
        if(!Current.Request.bReaction&&(!bLive||Live.IsAttack())) ++PlayedAttacks;
    }
    if(!bActive) return false;
    const auto& P=Current.Plan;
    // Evaluate contact telemetry on the next tick, after the mesh evaluated the contact
    // sample. Measuring during the crossing would read the previous anticipation pose.
    if(bContact && Hold>0 && !P.bReaction) {
        const FVector Hand=C->GetMesh()->GetSocketLocation(*P.Motion.Effector);
        const auto& E=Current.Request.Event;
        const FVector Delta=E.TargetPosition-E.ActorPosition;
        const FVector Target=C->GetActorLocation()+FVector(Delta.X,Delta.Z,0)*100;
        MeasuredContactError=FVector::Dist2D(Hand,Target);
    }
    if(bLive) {LiveAge+=Dt;Age=LiveAge;Hold=0;}
    else if(Hold>0) Hold=FMath::Max(0.f,Hold-Dt);
    else {
        const float Next=Age+Dt;
        if(!bContact && Next>=P.ContactAt) {
            Age=P.ContactAt; bContact=true; Hold=P.FX.HitStop;
            if(Current.Request.bReaction) ++PlayedHits;
        } else Age=Next;
    }
    if(Age>=P.Duration) {
        C->GetMesh()->SetRelativeLocation(BaseLocation); C->GetMesh()->SetRelativeRotation(BaseRotation);
        C->Camera->SetRelativeLocation(FVector::ZeroVector); if(Ribbon) Ribbon->ClearAllMeshSections(); if(Flash) Flash->SetVisibility(false);
        bActive=false; return false;
    }
    const FVector Offset=P.Offset(Age).GetClampedToMaxSize(P.OffsetLimitCm);
    MaxOffset=FMath::Max(MaxOffset,static_cast<float>(Offset.Size()));
    C->GetMesh()->SetRelativeLocation(BaseLocation+Offset);
    const FVector LeanAxis=FRotator(0,P.LeanYaw,0).RotateVector(FVector::RightVector);
    const FQuat Rotation=FQuat(LeanAxis,FMath::DegreesToRadians(P.Lean(Age)))*FRotator(0,P.Yaw(Age),0).Quaternion()*BaseRotation.Quaternion();
    C->GetMesh()->SetRelativeRotation(Rotation);
    if(auto* Anim=Cast<UTVCombatAnimInstance>(C->GetMesh()->GetAnimInstance())) {
        Anim->Time=P.SampleTime(Age); Anim->Weight=P.Weight(Age);
        Anim->Duck=bLive?Live.Duck(Age):0;
        Anim->bLowStrike=bLive&&Live.Trajectory==TEXT("low");
        Anim->HandWeight=bLive&&Live.IsAttack()?FMath::Clamp((Age-(Live.ActiveAt-Live.StartedAt)+.10)/.10,0.,1.)*(1-FMath::Clamp((Age-(Live.RecoveryAt-Live.StartedAt))/.18,0.,1.)):0;
        if(bLive) {
            if(!Live.IsAttack())Anim->Weight=0;
            const FVector Point=Live.StrikePoint(Age);
            const FVector Goal=C->GetActorLocation()+FVector(Point.X,Point.Z,Point.Y)*100-FVector(0,0,90);
            Anim->HandGoal=C->GetMesh()->GetComponentTransform().InverseTransformPosition(Goal);
        }
        Anim->FootLock=P.LOD==0 && !P.bReaction?(bLive&&Live.Kind==TEXT("duck")?1.f:P.Weight(Age)):0;
        // Lock the planted foot against mesh warp. A capable fighter can step into an angle
        // and recover; the actor/capsule still follows the canonical transform unchanged.
        FVector Step=FVector::ZeroVector;
        if(P.Style.Complexity>=2) {
            const float Phase=Age<P.ContactAt?FMath::Clamp(Age/P.ContactAt,0.f,1.f):1-FMath::Clamp((Age-P.ContactAt)/P.Recovery,0.f,1.f);
            Step=FVector(6*Phase,(P.PivotYaw<0?-4:4)*Phase,4*FMath::Sin(PI*Phase));
        }
        const FTransform Actor=C->GetActorTransform(),Mesh=C->GetMesh()->GetComponentTransform();
        Anim->LeftFoot=Mesh.InverseTransformPosition(Actor.TransformPosition(LeftAnchor));
        Anim->RightFoot=Mesh.InverseTransformPosition(Actor.TransformPosition(RightAnchor+Step));
    }
    Effects(Dt);
    return true;
}
void UTVCombatPresentationComponent::Effects(float Dt) {
    auto* C=CastChecked<ATVCharacter>(GetOwner()); const auto& P=Current.Plan;
    if(P.LOD>0) { if(Ribbon) Ribbon->ClearAllMeshSections(); if(Flash) Flash->SetVisibility(false); return; }
    if(!Ribbon) {
        Ribbon=NewObject<UProceduralMeshComponent>(C,TEXT("CombatRibbon")); Ribbon->SetupAttachment(C->GetRootComponent()); Ribbon->RegisterComponent();
        Ribbon->SetCollisionEnabled(ECollisionEnabled::NoCollision); Ribbon->SetCastShadow(false);
        auto* Material=LoadObject<UMaterialInterface>(nullptr,TEXT("/Game/TornVeil/Combat/Effects/M_TV_CombatLight"));
        if(Material) { EffectMaterial=UMaterialInstanceDynamic::Create(Material,this); Ribbon->SetMaterial(0,EffectMaterial); }
        Flash=NewObject<UStaticMeshComponent>(C,TEXT("CombatImpact")); Flash->SetupAttachment(C->GetRootComponent()); Flash->RegisterComponent();
        Flash->SetStaticMesh(LoadObject<UStaticMesh>(nullptr,TEXT("/Engine/BasicShapes/Sphere"))); Flash->SetCollisionEnabled(ECollisionEnabled::NoCollision); Flash->SetCastShadow(false);
        if(EffectMaterial) Flash->SetMaterial(0,EffectMaterial);
    }
    if(EffectMaterial) EffectMaterial->SetVectorParameterValue(TEXT("Colour"),P.FX.Colour);
    const FVector Hand=C->GetMesh()->GetSocketLocation(*P.Motion.Effector);
    const bool bTrail=(!bLive||Live.IsAttack()) && !P.bReaction && Age>P.Anticipation && Age<P.ContactAt+.09f;
    if(bTrail) { Trail.Add(Hand); if(Trail.Num()>8) Trail.RemoveAt(0); }
    else if(Trail.Num()) Trail.RemoveAt(0);
    TArray<FVector> Vertices; TArray<int32> Triangles; TArray<FLinearColor> Colours;
    auto Quad=[&](const FVector& A,const FVector& B,float Width,const FLinearColor& Colour) {
        const int32 I=Vertices.Num(); const FVector Up(0,0,Width);
        Vertices.Append({C->GetActorTransform().InverseTransformPosition(A-Up),C->GetActorTransform().InverseTransformPosition(A+Up),
            C->GetActorTransform().InverseTransformPosition(B-Up),C->GetActorTransform().InverseTransformPosition(B+Up)});
        Triangles.Append({I,I+2,I+1,I+1,I+2,I+3}); for(int32 K=0;K<4;++K) Colours.Add(Colour);
    };
    for(int32 I=1;I<Trail.Num();++I) Quad(Trail[I-1],Trail[I],(.5f+P.FX.Trail*2)*I/Trail.Num(),P.FX.Colour);
    if(P.FX.bMagicFixture && Age>P.Anticipation && Age<P.ContactAt+.16f) {
        const float Radius=12+24*FMath::Clamp((Age-P.Anticipation)/P.Strike,0.f,1.f);
        const auto Delta=Current.Request.Event.TargetPosition-Current.Request.Event.ActorPosition;
        const FVector Forward=FVector(Delta.X,Delta.Z,0).GetSafeNormal();
        const FVector Side=FVector::CrossProduct(FVector::UpVector,Forward);
        const FVector Origin=Hand-Forward*12;
        for(int32 I=0;I<28;++I) {
            const float A=I*2*PI/28,B=(I+1)*2*PI/28;
            const FVector X=Origin+(Side*FMath::Cos(A)+FVector::UpVector*FMath::Sin(A))*Radius;
            const FVector Y=Origin+(Side*FMath::Cos(B)+FVector::UpVector*FMath::Sin(B))*Radius;
            Quad(X,Y,.8f,P.FX.Colour);
        }
    }
    Ribbon->CreateMeshSection_LinearColor(0,Vertices,Triangles,TArray<FVector>(),TArray<FVector2D>(),Colours,TArray<FProcMeshTangent>(),false);
    const float ImpactAge=Age-P.ContactAt;
    const bool bFlash=bLive?LiveContactReceivedAt>=0&&GetWorld()->GetTimeSeconds()-LiveContactReceivedAt<.09f:!P.bReaction && P.FX.Impact>0 && ImpactAge>=0 && ImpactAge<.09f;
    Flash->SetVisibility(bFlash);
    if(bFlash) { const auto* Bridge=GetWorld()->GetSubsystem<UTVBridgeSubsystem>();
        Flash->SetWorldLocation(bLive&&Bridge?Bridge->ToUnreal(Live.ContactPosition)-FVector(0,0,90):Hand); Flash->SetWorldScale3D(FVector(bLive?.07f:(.025f+P.FX.Impact*.065f)*(1-ImpactAge/.09f))); }
    if(C->IsPlayerControlled() && P.FX.Camera>0 && bContact) {
        const float Cue=FMath::Max(0.f,1-ImpactAge/.15f);
        C->Camera->SetRelativeLocation(FVector(-1.4f*P.FX.Camera*Cue,0,.5f*Cue));
    }
}
void UTVCombatPresentationComponent::WriteDiagnostics(const TSharedPtr<FJsonObject>& J) const {
    J->SetBoolField(TEXT("liveCombat"),bLive);J->SetStringField(TEXT("liveActionId"),Live.Id);J->SetStringField(TEXT("liveCommandId"),Live.CommandId);
    J->SetStringField(TEXT("livePhase"),Live.Phase);
    if(bLive&&Live.IsAttack()&&Age>=Live.ActiveAt-Live.StartedAt&&Age<=Live.RecoveryAt-Live.StartedAt)if(const auto* C=Cast<ATVCharacter>(GetOwner())) {
        const FVector P=Live.StrikePoint(Age),Goal=C->GetActorLocation()+FVector(P.X,P.Z,P.Y)*100-FVector(0,0,90);
        J->SetNumberField(TEXT("strikeEffectorErrorCm"),FVector::Dist(C->GetMesh()->GetSocketLocation(*Current.Plan.Motion.Effector),Goal));
    }
    J->SetStringField(TEXT("liveKind"),Live.Kind);J->SetStringField(TEXT("liveOutcome"),Live.Outcome);J->SetNumberField(TEXT("duck"),Live.Duck(Age));
    J->SetBoolField(TEXT("choreographyActive"),bActive); J->SetNumberField(TEXT("choreographySeq"),Current.Request.Event.Seq);
    J->SetNumberField(TEXT("choreographyPending"),Queue.Num()); J->SetNumberField(TEXT("choreographyDropped"),Dropped);
    J->SetNumberField(TEXT("presentationOffsetCm"),bActive?Current.Plan.Offset(Age).Size():0); J->SetNumberField(TEXT("maxPresentationOffsetCm"),MaxOffset);
    J->SetNumberField(TEXT("alignmentYaw"),Current.Plan.AlignmentYaw); J->SetNumberField(TEXT("plannedContactErrorCm"),Current.Plan.ContactErrorCm);
    J->SetNumberField(TEXT("leanDegrees"),Current.Plan.LeanDegrees);
    J->SetNumberField(TEXT("measuredContactErrorCm"),MeasuredContactError); J->SetNumberField(TEXT("presentationHoldSeconds"),Hold);
    J->SetNumberField(TEXT("choreographyAge"),Age); J->SetNumberField(TEXT("choreographyLOD"),Current.Plan.LOD);
    J->SetNumberField(TEXT("complexity"),Current.Plan.Style.Complexity); J->SetNumberField(TEXT("control"),Current.Plan.Style.Control);
    J->SetNumberField(TEXT("force"),Current.Plan.Style.Force); J->SetNumberField(TEXT("signatureSeed"),Current.Plan.Signature.Seed);
    J->SetStringField(TEXT("primitive"),Current.Plan.Motion.Id); J->SetStringField(TEXT("weaponFamily"),Current.Plan.WeaponFamily);
    J->SetBoolField(TEXT("magicFixture"),Current.Plan.FX.bMagicFixture);
    TArray<TSharedPtr<FJsonValue>> Sequences; for(auto Seq:PlayedSequences) Sequences.Add(MakeShared<FJsonValueNumber>(Seq)); J->SetArrayField(TEXT("playedChoreographySequences"),Sequences);
}
