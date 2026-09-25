#include "TVCombatAnimInstance.h"
#include "Animation/AnimInstanceProxy.h"
#include "Animation/AnimSequence.h"
#include "AnimNodes/AnimNode_SequenceEvaluator.h"
#include "AnimNodes/AnimNode_TwoWayBlend.h"
#include "AnimNodes/AnimNode_PoseSnapshot.h"
#include "AnimNodes/AnimNode_BlendSpacePlayer.h"
#include "TwoBoneIK.h"
#include "TVCombatPoseFlow.h"

struct FTVCombatAnimProxy : FAnimInstanceProxy {
    FAnimNode_SequenceEvaluator_Standalone BasePose, MotionPose, FuturePose;
    FAnimNode_TwoWayBlend Blend, BaseSelection, MotionSelection;
    FAnimNode_PoseSnapshot Snapshot;
    FAnimNode_BlendSpacePlayer_Standalone Locomotion;
    FVector LeftGoal, RightGoal;
    float IKWeight=0,HandWeight=0,Duck=0,Guard=0;
    FVector GuardLeftGoal,GuardRightGoal;
    FVector HandGoal;
    bool bLowStrike=false,bReleaseRightFoot=false;
    TArray<FTransform> History, Older;
    TArray<FVector> RotationOffset, RotationVelocity, PositionOffset, PositionVelocity;
    uint32 Serial=0,RequestedSerial=0;
    float FlowAge=0,FlowDuration=0,Delta=1.f/60,HistoryDelta=1.f/60;
    bool bFlow=false;
    bool bCarrySupport=false;
    FVector CarriedSupport=FVector::ZeroVector;
    float RawAngular=0,FirstAngular=0,PelvisJump=0,RootJump=0,FootJump=0;
    FTVCombatAnimProxy(UAnimInstance* Instance):FAnimInstanceProxy(Instance) {
        BaseSelection.A.SetLinkNode(&BasePose);BaseSelection.B.SetLinkNode(&Snapshot);
        MotionSelection.A.SetLinkNode(&MotionPose);MotionSelection.B.SetLinkNode(&Locomotion);
        Blend.A.SetLinkNode(&BaseSelection); Blend.B.SetLinkNode(&MotionSelection);
        Snapshot.Mode=ESnapshotSourceMode::SnapshotPin;
        BasePose.SetTeleportToExplicitTime(true); MotionPose.SetTeleportToExplicitTime(true);
        BasePose.SetShouldLoop(false); MotionPose.SetShouldLoop(false);
        FuturePose.SetTeleportToExplicitTime(true);FuturePose.SetShouldLoop(false);
    }
    virtual FAnimNode_Base* GetCustomRootNode() override { return &Blend; }
    virtual void GetCustomNodes(TArray<FAnimNode_Base*>& Nodes) override { Nodes.Append({&Blend,&BaseSelection,&MotionSelection,&Snapshot,&Locomotion,&BasePose,&MotionPose,&FuturePose}); }
    virtual void PreUpdate(UAnimInstance* Instance,float Dt) override {
        FAnimInstanceProxy::PreUpdate(Instance,Dt);
        auto* A=CastChecked<UTVCombatAnimInstance>(Instance);
        BasePose.SetSequence(A->Base); BasePose.SetExplicitTime(A->BaseTime);
        MotionPose.SetSequence(A->Motion); MotionPose.SetExplicitTime(A->Time);
        FuturePose.SetSequence(A->Motion);FuturePose.SetExplicitTime(A->Time+1.f/120);
        RequestedSerial=A->FlowSerial;bFlow=A->bFlow;FlowDuration=A->FlowDuration;Delta=FMath::Max(Dt,.001f);
        Snapshot.Snapshot=A->Snapshot;Snapshot.PreUpdate(Instance);BaseSelection.Alpha=A->bSnapshot&&A->Snapshot.bIsValid?1.f:0.f;
        Locomotion.SetBlendSpace(A->Locomotion);Locomotion.SetPosition(A->LocomotionPosition);MotionSelection.Alpha=A->bLocomotion?1.f:0.f;
        Blend.Alpha=FMath::Clamp(A->Weight,0.f,1.f);
        LeftGoal=A->LeftFoot; RightGoal=A->RightFoot; IKWeight=A->FootLock;
        bCarrySupport=A->bCarrySupport&&bFlow;
        Guard=A->Guard;GuardLeftGoal=A->GuardLeftGoal;GuardRightGoal=A->GuardRightGoal;HandWeight=A->HandWeight;HandGoal=A->HandGoal;Duck=A->Duck;bLowStrike=A->bLowStrike;bReleaseRightFoot=A->bReleaseRightFoot;
    }
    virtual bool Evaluate(FPoseContext& Output) override {
        Blend.Evaluate_AnyThread(Output);
        const int32 Count=Output.Pose.GetNumBones();
        const bool Handoff=bFlow&&RequestedSerial!=Serial&&History.Num()==Count;
        if(bFlow&&RequestedSerial!=Serial) {
            Serial=RequestedSerial;FlowAge=0;
            if(History.Num()!=Count&&Snapshot.Snapshot.bIsValid){
                History.SetNum(Count);Older.Empty();
                for(int32 I=0;I<Count;++I){const auto& Container=Output.Pose.GetBoneContainer();const FName Name=Container.GetReferenceSkeleton().GetBoneName(Container.MakeMeshPoseIndex(FCompactPoseBoneIndex(I)).GetInt());const int32 Index=Snapshot.Snapshot.BoneNames.IndexOfByKey(Name);History[I]=Snapshot.Snapshot.LocalTransforms.IsValidIndex(Index)?Snapshot.Snapshot.LocalTransforms[Index]:Output.Pose[FCompactPoseBoneIndex(I)];}
            }
            if(bCarrySupport&&History.Num()==Count){
                // The inherited support point is in pose space. Canonical attack
                // displacement is zero; actor/camera transforms never enter this constraint.
                TArray<FTransform> CS;CS.SetNum(Count);const auto& Container=Output.Pose.GetBoneContainer();
                for(int32 I=0;I<Count;++I){const FCompactPoseBoneIndex B(I);const auto Parent=Container.GetParentBoneIndex(B);CS[I]=Parent==INDEX_NONE?History[I]:History[I]*CS[Parent.GetInt()];if(Container.GetReferenceSkeleton().GetBoneName(Container.MakeMeshPoseIndex(B).GetInt())==TEXT("foot_l"))CarriedSupport=CS[I].GetLocation();}
            }
            RotationOffset.SetNumZeroed(Count);RotationVelocity.SetNumZeroed(Count);PositionOffset.SetNumZeroed(Count);PositionVelocity.SetNumZeroed(Count);
            FPoseContext Future(Output);FuturePose.Evaluate_AnyThread(Future);
            for(int32 I=0;I<Count;++I) {
                const FCompactPoseBoneIndex B(I);const auto& Target=Output.Pose[B];
                const FTransform* From=History.Num()==Count?&History[I]:nullptr;
                if(!From)continue;
                RotationOffset[I]=TVCombatPoseFlow::RotationDelta(From->GetRotation(),Target.GetRotation());
                FVector OutAngular=FVector::ZeroVector,OutLinear=FVector::ZeroVector;
                if(Older.Num()==Count){OutAngular=TVCombatPoseFlow::RotationDelta(From->GetRotation(),Older[I].GetRotation())/HistoryDelta;OutLinear=(From->GetLocation()-Older[I].GetLocation())/HistoryDelta;}
                const FVector Incoming=TVCombatPoseFlow::RotationDelta(Future.Pose[B].GetRotation(),Target.GetRotation())*120;
                RotationVelocity[I]=(OutAngular-Incoming).GetClampedToMaxSize(12);
                // Root translation always remains authored zero. Pelvis/body offsets are local pose only.
                if(I>0){PositionOffset[I]=From->GetLocation()-Target.GetLocation();PositionVelocity[I]=(OutLinear-(Future.Pose[B].GetLocation()-Target.GetLocation())*120).GetClampedToMaxSize(100);}
            }
        } else FlowAge+=Delta;
        if(bFlow&&FlowAge<FlowDuration&&RotationOffset.Num()==Count)for(int32 I=0;I<Count;++I){
            auto& T=Output.Pose[FCompactPoseBoneIndex(I)];
            T.SetRotation((FQuat::MakeFromRotationVector(TVCombatPoseFlow::Residual(RotationOffset[I],RotationVelocity[I],FlowAge,FlowDuration))*T.GetRotation()).GetNormalized());
            if(I>0)T.AddToTranslation(TVCombatPoseFlow::Residual(PositionOffset[I],PositionVelocity[I],FlowAge,FlowDuration));
        }
        if(IKWeight>0||HandWeight>0||Duck>0||Guard>0) {
        FCSPose<FCompactPose> CS; CS.InitPose(Output.Pose);
        const auto& Bones=Output.Pose.GetBoneContainer();
        for(int32 Side=0;Side<2;++Side) {
            if(Side==1&&(bReleaseRightFoot||bLowStrike&&HandWeight>0))continue;
            const int32 MeshIndex=Bones.GetPoseBoneIndexForBoneName(Side==0?TEXT("foot_l"):TEXT("foot_r"));
            if(MeshIndex==INDEX_NONE) continue;
            const auto Foot=Bones.MakeCompactPoseIndex(FMeshPoseBoneIndex(MeshIndex));
            if(Foot==INDEX_NONE) continue;
            const auto Shin=Bones.GetParentBoneIndex(Foot), Thigh=Bones.GetParentBoneIndex(Shin);
            if(Shin==INDEX_NONE || Thigh==INDEX_NONE) continue;
            FTransform A=CS.GetComponentSpaceTransform(Thigh), B=CS.GetComponentSpaceTransform(Shin), C=CS.GetComponentSpaceTransform(Foot);
            const FVector Target=Side==0?(bCarrySupport?CarriedSupport:LeftGoal):RightGoal;
            // Only a declared support foot carries a chain plant. No leg stretching,
            // pelvis/root translation, or constraint on the striking/rear foot.
            const FVector Goal=C.GetLocation()+((Target-C.GetLocation())*IKWeight).GetClampedToMaxSize(bCarrySupport&&Side==0?25:3);
            if(Goal.Equals(C.GetLocation(),.01))continue;
            // Preserve the evaluated knee plane. A fixed world pole twisted the
            // support leg even when the foot goal already matched the outgoing pose.
            AnimationCore::SolveTwoBoneIK(A,B,C,B.GetLocation(),Goal,false,1.0,1.0);
            TArray<FBoneTransform> Changes; Changes.Emplace(Thigh,A);Changes.Emplace(Shin,B);Changes.Emplace(Foot,C);
            CS.SafeSetCSBoneTransforms(Changes);
        }
        if(Guard>0)for(int32 Side=0;Side<2;++Side){
            const int32 MeshIndex=Bones.GetPoseBoneIndexForBoneName(Side==0?TEXT("hand_l"):TEXT("hand_r"));
            if(MeshIndex==INDEX_NONE)continue;
            const auto Hand=Bones.MakeCompactPoseIndex(FMeshPoseBoneIndex(MeshIndex));if(Hand==INDEX_NONE)continue;
            const auto Elbow=Bones.GetParentBoneIndex(Hand);if(Elbow==INDEX_NONE)continue;
            const auto Shoulder=Bones.GetParentBoneIndex(Elbow);if(Shoulder==INDEX_NONE)continue;
            FTransform A=CS.GetComponentSpaceTransform(Shoulder),B=CS.GetComponentSpaceTransform(Elbow),C=CS.GetComponentSpaceTransform(Hand);
            const FVector Goal=FMath::Lerp(C.GetLocation(),Side==0?GuardLeftGoal:GuardRightGoal,Guard);
            AnimationCore::SolveTwoBoneIK(A,B,C,B.GetLocation(),Goal,false,1,1);
            TArray<FBoneTransform> Changes;Changes.Emplace(Shoulder,A);Changes.Emplace(Elbow,B);Changes.Emplace(Hand,C);CS.SafeSetCSBoneTransforms(Changes);
        }
        FCSPose<FCompactPose>::ConvertComponentPosesToLocalPoses(MoveTemp(CS),Output.Pose);
        }
        if(Handoff){
            float Raw=0,Effective=0;int32 Measured=0;TArray<FTransform> BeforeCS,AfterCS;BeforeCS.SetNum(Count);AfterCS.SetNum(Count);
            const auto& Container=Output.Pose.GetBoneContainer();
            for(int32 I=0;I<Count;++I){
                const FCompactPoseBoneIndex B(I);const auto Parent=Container.GetParentBoneIndex(B);
                BeforeCS[I]=Parent==INDEX_NONE?History[I]:History[I]*BeforeCS[Parent.GetInt()];
                AfterCS[I]=Parent==INDEX_NONE?Output.Pose[B]:Output.Pose[B]*AfterCS[Parent.GetInt()];
                const FName Name=Container.GetReferenceSkeleton().GetBoneName(Container.MakeMeshPoseIndex(B).GetInt());
                if(Name==TEXT("pelvis"))PelvisJump=FVector::Dist(BeforeCS[I].GetLocation(),AfterCS[I].GetLocation());
                if(Name==TEXT("root"))RootJump=FVector::Dist(BeforeCS[I].GetLocation(),AfterCS[I].GetLocation());
                if(Name==TEXT("foot_l"))FootJump=FVector::Dist(BeforeCS[I].GetLocation(),AfterCS[I].GetLocation());
                const FString N=Name.ToString();
                if(N==TEXT("pelvis")||N==TEXT("head")||N==TEXT("root")||N.StartsWith(TEXT("spine_"))||N.StartsWith(TEXT("upperarm_"))||N.StartsWith(TEXT("lowerarm_"))||N.StartsWith(TEXT("thigh_"))||N.StartsWith(TEXT("calf_"))||N.StartsWith(TEXT("foot_"))){
                    Raw+=RotationOffset[I].SizeSquared();Effective+=TVCombatPoseFlow::RotationDelta(Output.Pose[B].GetRotation(),History[I].GetRotation()).SizeSquared();++Measured;
                }
            }
            RawAngular=FMath::RadiansToDegrees(FMath::Sqrt(Raw/FMath::Max(1,Measured)));FirstAngular=FMath::RadiansToDegrees(FMath::Sqrt(Effective/FMath::Max(1,Measured)));
        }
        Older=MoveTemp(History);History.SetNum(Count);
        for(int32 I=0;I<Count;++I)History[I]=Output.Pose[FCompactPoseBoneIndex(I)];
        HistoryDelta=Delta;
        return true;
    }
};
UTVCombatAnimInstance::UTVCombatAnimInstance() { SetRootMotionMode(ERootMotionMode::IgnoreRootMotion); }
FAnimInstanceProxy* UTVCombatAnimInstance::CreateAnimInstanceProxy() { return new FTVCombatAnimProxy(this); }
void UTVCombatAnimInstance::DestroyAnimInstanceProxy(FAnimInstanceProxy* Proxy) { delete Proxy; }
void UTVCombatAnimInstance::NativePostEvaluateAnimation(){
    Super::NativePostEvaluateAnimation();const auto& P=GetProxyOnGameThread<FTVCombatAnimProxy>();
    FlowRawAngularDegrees=P.RawAngular;FlowFirstAngularDegrees=P.FirstAngular;FlowPelvisJumpCm=P.PelvisJump;FlowRootJumpCm=P.RootJump;FlowFootJumpCm=P.FootJump;
    EvaluatedLocomotionTime=P.Locomotion.GetCurrentAssetTime();
}
