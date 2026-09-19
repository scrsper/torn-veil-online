// Reproducible, editor-only authoring of owned pose adapters. Vendor assets are never changed.
#if WITH_EDITOR
#include "CoreMinimal.h"
#include "HAL/IConsoleManager.h"
#include "Animation/AnimBlueprint.h"
#include "AnimGraphNode_Root.h"
#include "AnimGraphNode_CopyPoseFromMesh.h"
#include "AnimGraphNode_RetargetPoseFromMesh.h"
#include "EdGraph/EdGraph.h"
#include "EdGraph/EdGraphSchema.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "UObject/UnrealType.h"

namespace {
    void BuildPoseAdapter(const TArray<FString>& Args) {
        // Existing, empty ABPs only. Python creates the asset with the correct target skeleton
        // and saves it after checking compilation. This command never silently replaces a graph.
        if (Args.Num() != 2 || !Args[0].StartsWith(TEXT("/Game/TornVeil/Characters/Retarget/"))) {
            UE_LOG(LogTemp, Error, TEXT("TV_FOUNDRY_ADAPTER expected owned ABP path and CopyPose or retargeter path"));
            return;
        }
        UAnimBlueprint* Blueprint = LoadObject<UAnimBlueprint>(nullptr, *Args[0]);
        if (!Blueprint || !Blueprint->TargetSkeleton) return;
        TArray<UEdGraph*> Graphs;
        Blueprint->GetAllGraphs(Graphs);
        UEdGraph* Graph = nullptr;
        UAnimGraphNode_Root* Root = nullptr;
        for (UEdGraph* Candidate : Graphs) {
            if (Candidate->GetFName() != TEXT("AnimGraph")) continue;
            Graph = Candidate;
            for (UEdGraphNode* Node : Candidate->Nodes) {
                if (UAnimGraphNode_Root* Found = Cast<UAnimGraphNode_Root>(Node)) Root = Found;
            }
        }
        if (!Graph || !Root || Graph->Nodes.Num() != 1) {
            UE_LOG(LogTemp, Error, TEXT("TV_FOUNDRY_ADAPTER refusing nonempty or missing AnimGraph"));
            return;
        }
        UIKRetargeter* Retargeter = nullptr;
        const bool bCopyPose = Args[1] == TEXT("CopyPose");
        if (!bCopyPose) {
            Retargeter = LoadObject<UIKRetargeter>(nullptr, *Args[1]);
            if (!Retargeter) return;
        }
        Blueprint->Modify(); Graph->Modify(); Root->Modify();
        UAnimGraphNode_Base* PoseNode = nullptr;
        if (bCopyPose) {
            FGraphNodeCreator<UAnimGraphNode_CopyPoseFromMesh> Creator(*Graph);
            UAnimGraphNode_CopyPoseFromMesh* Node = Creator.CreateNode();
            FStructProperty* Property = FindFProperty<FStructProperty>(Node->GetClass(), TEXT("Node"));
            FAnimNode_CopyPoseFromMesh* Runtime = Property->ContainerPtrToValuePtr<FAnimNode_CopyPoseFromMesh>(Node);
            Runtime->bUseAttachedParent = true;
            Runtime->bCopyCurves = true;
            Creator.Finalize();
            PoseNode = Node;
        } else {
            FGraphNodeCreator<UAnimGraphNode_RetargetPoseFromMesh> Creator(*Graph);
            UAnimGraphNode_RetargetPoseFromMesh* Node = Creator.CreateNode();
            FStructProperty* Property = FindFProperty<FStructProperty>(Node->GetClass(), TEXT("Node"));
            FAnimNode_RetargetPoseFromMesh* Runtime = Property->ContainerPtrToValuePtr<FAnimNode_RetargetPoseFromMesh>(Node);
            Runtime->IKRetargeterAsset = Retargeter;
            Runtime->RetargetFrom = ERetargetSourceMode::ParentSkeletalMeshComponent;
            Creator.Finalize();
            PoseNode = Node;
        }
        PoseNode->NodePosX = Root->NodePosX - 350;
        PoseNode->NodePosY = Root->NodePosY;
        UEdGraphPin* Output = nullptr;
        UEdGraphPin* Input = nullptr;
        for (UEdGraphPin* Pin : PoseNode->Pins) if (Pin->Direction == EGPD_Output) { Output = Pin; break; }
        for (UEdGraphPin* Pin : Root->Pins) if (Pin->Direction == EGPD_Input) { Input = Pin; break; }
        if (!Output || !Input || !Graph->GetSchema()->TryCreateConnection(Output, Input)) {
            FBlueprintEditorUtils::RemoveNode(Blueprint, PoseNode, true);
            UE_LOG(LogTemp, Error, TEXT("TV_FOUNDRY_ADAPTER pose connection failed"));
            return;
        }
        FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(Blueprint);
        FKismetEditorUtilities::CompileBlueprint(Blueprint);
        UE_LOG(LogTemp, Display, TEXT("TV_FOUNDRY_ADAPTER %s status=%d"), *Args[0], static_cast<int32>(Blueprint->Status));
    }
    FAutoConsoleCommand PoseAdapterCommand(TEXT("TV.BuildPoseAdapter"),
        TEXT("TV.BuildPoseAdapter <owned empty AnimBlueprint> <CopyPose|IKRetargeter>"),
        FConsoleCommandWithArgsDelegate::CreateStatic(&BuildPoseAdapter));
}
#endif
