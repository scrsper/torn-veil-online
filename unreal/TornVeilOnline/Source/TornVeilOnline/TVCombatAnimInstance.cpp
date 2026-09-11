#include "TVCombatAnimInstance.h"
#include "Animation/AnimInstanceProxy.h"
#include "Animation/AnimSequence.h"
#include "AnimNodes/AnimNode_SequenceEvaluator.h"
#include "AnimNodes/AnimNode_TwoWayBlend.h"
#include "TwoBoneIK.h"

struct FTVCombatAnimProxy : FAnimInstanceProxy {
    FAnimNode_SequenceEvaluator_Standalone BasePose, MotionPose;
    FAnimNode_TwoWayBlend Blend;
    FVector LeftGoal, RightGoal;
    float IKWeight=0,HandWeight=0,Duck=0;
    FVector HandGoal;
    bool bLowStrike=false;
    FTVCombatAnimProxy(UAnimInstance* Instance):FAnimInstanceProxy(Instance) {
        Blend.A.SetLinkNode(&BasePose); Blend.B.SetLinkNode(&MotionPose);
        BasePose.SetTeleportToExplicitTime(true); MotionPose.SetTeleportToExplicitTime(true);
        BasePose.SetShouldLoop(false); MotionPose.SetShouldLoop(false);
    }
    virtual FAnimNode_Base* GetCustomRootNode() override { return &Blend; }
    virtual void GetCustomNodes(TArray<FAnimNode_Base*>& Nodes) override { Nodes.Add(&Blend); Nodes.Add(&BasePose); Nodes.Add(&MotionPose); }
    virtual void PreUpdate(UAnimInstance* Instance,float Dt) override {
        FAnimInstanceProxy::PreUpdate(Instance,Dt);
        auto* A=CastChecked<UTVCombatAnimInstance>(Instance);
        BasePose.SetSequence(A->Base); BasePose.SetExplicitTime(0);
        MotionPose.SetSequence(A->Motion); MotionPose.SetExplicitTime(A->Time);
        Blend.Alpha=FMath::Clamp(A->Weight,0.f,1.f);
        LeftGoal=A->LeftFoot; RightGoal=A->RightFoot; IKWeight=A->FootLock;
        HandWeight=A->HandWeight;HandGoal=A->HandGoal;Duck=A->Duck;bLowStrike=A->bLowStrike;
    }
    virtual bool Evaluate(FPoseContext& Output) override {
        Blend.Evaluate_AnyThread(Output);
        if(IKWeight<=0&&HandWeight<=0&&Duck<=0) return true;
        FCSPose<FCompactPose> CS; CS.InitPose(Output.Pose);
        const auto& Bones=Output.Pose.GetBoneContainer();
        if(Duck>0) {
            const int32 Index=Bones.GetPoseBoneIndexForBoneName(TEXT("pelvis"));
            if(Index!=INDEX_NONE){const auto Bone=Bones.MakeCompactPoseIndex(FMeshPoseBoneIndex(Index));if(Bone!=INDEX_NONE){auto T=CS.GetComponentSpaceTransform(Bone);T.AddToTranslation(FVector(0,0,-50*Duck));TArray<FBoneTransform> Changes;Changes.Emplace(Bone,T);CS.SafeSetCSBoneTransforms(Changes);}}
        }
        if(HandWeight>0) {
            const int32 Index=Bones.GetPoseBoneIndexForBoneName(bLowStrike?TEXT("foot_r"):TEXT("hand_r"));
            if(Index!=INDEX_NONE){const auto Hand=Bones.MakeCompactPoseIndex(FMeshPoseBoneIndex(Index));if(Hand!=INDEX_NONE){const auto Forearm=Bones.GetParentBoneIndex(Hand),Upper=Bones.GetParentBoneIndex(Forearm);
                if(Forearm!=INDEX_NONE&&Upper!=INDEX_NONE){auto A=CS.GetComponentSpaceTransform(Upper),B=CS.GetComponentSpaceTransform(Forearm),C=CS.GetComponentSpaceTransform(Hand);
                    AnimationCore::SolveTwoBoneIK(A,B,C,B.GetLocation()+FVector(0,-50,10),FMath::Lerp(C.GetLocation(),HandGoal,HandWeight),false,1.0,1.0);
                    TArray<FBoneTransform> Changes;Changes.Emplace(Upper,A);Changes.Emplace(Forearm,B);Changes.Emplace(Hand,C);CS.SafeSetCSBoneTransforms(Changes);}}}
        }
        for(int32 Side=0;Side<2;++Side) {
            if(bLowStrike&&HandWeight>0&&Side==1)continue;
            const int32 MeshIndex=Bones.GetPoseBoneIndexForBoneName(Side==0?TEXT("foot_l"):TEXT("foot_r"));
            if(MeshIndex==INDEX_NONE) continue;
            const auto Foot=Bones.MakeCompactPoseIndex(FMeshPoseBoneIndex(MeshIndex));
            if(Foot==INDEX_NONE) continue;
            const auto Shin=Bones.GetParentBoneIndex(Foot), Thigh=Bones.GetParentBoneIndex(Shin);
            if(Shin==INDEX_NONE || Thigh==INDEX_NONE) continue;
            FTransform A=CS.GetComponentSpaceTransform(Thigh), B=CS.GetComponentSpaceTransform(Shin), C=CS.GetComponentSpaceTransform(Foot);
            const FVector Goal=FMath::Lerp(C.GetLocation(),Side==0?LeftGoal:RightGoal,IKWeight);
            AnimationCore::SolveTwoBoneIK(A,B,C,B.GetLocation()+FVector(0,60,0),Goal,false,1.0,1.0);
            TArray<FBoneTransform> Changes; Changes.Emplace(Thigh,A);Changes.Emplace(Shin,B);Changes.Emplace(Foot,C);
            CS.SafeSetCSBoneTransforms(Changes);
        }
        FCSPose<FCompactPose>::ConvertComponentPosesToLocalPoses(MoveTemp(CS),Output.Pose);
        return true;
    }
};
UTVCombatAnimInstance::UTVCombatAnimInstance() { SetRootMotionMode(ERootMotionMode::IgnoreRootMotion); }
FAnimInstanceProxy* UTVCombatAnimInstance::CreateAnimInstanceProxy() { return new FTVCombatAnimProxy(this); }
void UTVCombatAnimInstance::DestroyAnimInstanceProxy(FAnimInstanceProxy* Proxy) { delete Proxy; }
