#include "TVDirectionalBlendSpace.h"
#include "Animation/AnimSequence.h"
#include "Animation/BlendSpace.h"
bool UTVLocomotionAuthoring::ConfigureSamples(UBlendSpace* Blend,const TArray<UAnimSequence*>& Clips,const TArray<FVector>& Positions,const TArray<float>& Rates){
#if WITH_EDITOR
    if(!Blend||Clips.IsEmpty()||Clips.Num()!=Positions.Num()||Rates.Num()!=Clips.Num())return false;
    for(auto* Clip:Clips)if(!Clip)return false;
    Blend->Modify();Blend->SetSkeleton(Clips[0]->GetSkeleton());
    // Authoring mutation of a mutable asset, using the same parameter/sample structures as
    // the engine editor. Runtime uses an ordinary UBlendSpace, not a derived animation system.
    auto& Direction=const_cast<FBlendParameter&>(Blend->GetBlendParameter(0));Direction.DisplayName=TEXT("Direction");Direction.Min=-180;Direction.Max=180;Direction.GridNum=8;Direction.bWrapInput=true;
    auto& Speed=const_cast<FBlendParameter&>(Blend->GetBlendParameter(1));Speed.DisplayName=TEXT("Canonical speed (cm/s)");Speed.Min=0;Speed.Max=700;Speed.GridNum=7;
    while(Blend->GetNumberOfBlendSamples())Blend->DeleteSample(Blend->GetNumberOfBlendSamples()-1);
    for(int32 I=0;I<Clips.Num();++I){const int32 Index=Blend->AddSample(Clips[I],Positions[I]);if(Index==INDEX_NONE)return false;const_cast<FBlendSample&>(Blend->GetBlendSamples()[Index]).RateScale=Rates[I];}
    Blend->ValidateSampleData();Blend->ResampleData();Blend->PostEditChange();Blend->MarkPackageDirty();return true;
#else
    return false;
#endif
}
