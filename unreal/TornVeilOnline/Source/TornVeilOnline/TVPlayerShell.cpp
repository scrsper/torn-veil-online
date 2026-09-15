#include "TVBridgeSubsystem.h"
#include "TVCharacter.h"
#include "TVWorldProjection.h"
#include "TVInteractionFocus.h"
#include "TVInteractionSpec.generated.h"
#include "Components/SkeletalMeshComponent.h"
#include "GameFramework/PlayerController.h"
#include "Camera/PlayerCameraManager.h"
#include "Dom/JsonObject.h"
#include "Kismet/GameplayStatics.h"

TSharedRef<FJsonObject> UTVBridgeSubsystem::ControlState() const {
    auto J=MakeShared<FJsonObject>();const double Now=FPlatformTime::Seconds();
    auto* P=Cast<ATVCharacter>(UGameplayStatics::GetPlayerCharacter(GetWorld(),0));const FVector Input=P?P->IntentDirection():FVector::ZeroVector;
    J->SetNumberField(TEXT("wallSeconds"),Now);J->SetNumberField(TEXT("inputX"),Input.X);J->SetNumberField(TEXT("inputZ"),Input.Y);J->SetBoolField(TEXT("sprint"),P&&P->IsSprinting());
    J->SetBoolField(TEXT("modal"),HasModalScreen());J->SetBoolField(TEXT("controller"),bControls);J->SetBoolField(TEXT("transport"),bTransportConnected);
    J->SetStringField(TEXT("epoch"),InteractionEpoch);J->SetStringField(TEXT("bodyId"),InteractionBody);
    J->SetNumberField(TEXT("ack"),LastMovementAck);J->SetNumberField(TEXT("lastSequence"),Sequence);J->SetNumberField(TEXT("pending"),PendingMovement.Num());
    J->SetNumberField(TEXT("snapshotAge"),Now-LastSnapshotReceived);J->SetNumberField(TEXT("localStateAge"),Now-LastLocalStateAt);
    J->SetBoolField(TEXT("eligible"),Confirmed.bEligible);J->SetBoolField(TEXT("geometryReady"),GeometrySize>0&&PredictionColumns.Num()==GeometrySize*GeometrySize);
    J->SetNumberField(TEXT("correctionCm"),CorrectionCm);J->SetStringField(TEXT("restriction"),MovementRestriction);
    J->SetStringField(TEXT("focusedTarget"),FocusedTargetId);J->SetStringField(TEXT("focusedAction"),FocusedActionId);
    return J;
}
void UTVBridgeSubsystem::UpdateInteractionFocus() {
    FocusedTargetId.Empty();FocusedActionId.Empty();FocusedKind.Empty();NearbyInteraction.Empty();NearbyPrompt.Empty();TalkTargetBody.Empty();FocusedBounds=FBox2D(ForceInit);
    if(!IsLive()||HasModalScreen())return;
    auto* PC=GetWorld()->GetFirstPlayerController();if(!PC||!PC->PlayerCameraManager)return;
    int32 Width=0,Height=0;PC->GetViewportSize(Width,Height);double Best=TNumericLimits<double>::Max();
    const FVector2D Aim(Width*.5,Height*.5);
    for(const auto& T:FocusTargets) {
        FBox Bounds(ForceInit);
        if(T.Kind==TEXT("person")){auto* Body=Bodies.FindRef(T.Id).Get();if(!IsValid(Body)||Body->IsHidden())continue;Bounds=Body->GetMesh()->Bounds.GetBox();}
        else if(!WorldProjection||!WorldProjection->FindVisualBounds(T.Id,Bounds)) {
            const FVector Pos=ToUnreal(T.Position)-FVector(0,0,90);
            Bounds=FBox(Pos-FVector(18,18,0),Pos+FVector(18,18,35));
        }
        FBox2D Screen(ForceInit);bool Visible=true;
        for(int32 I=0;I<8;++I){FVector2D P;const FVector Corner((I&1)?Bounds.Max.X:Bounds.Min.X,(I&2)?Bounds.Max.Y:Bounds.Min.Y,(I&4)?Bounds.Max.Z:Bounds.Min.Z);
            if(!PC->ProjectWorldLocationToScreen(Corner,P,true)){Visible=false;break;}Screen+=P;}
        if(!Visible)continue;const double Score=TVInteractionFocus::Score(Screen,Aim,Height);
        if(Score<Best||(Score==Best&&T.Id<FocusedTargetId)){Best=Score;FocusedTargetId=T.Id;FocusedActionId=T.Action;FocusedKind=T.Kind;NearbyPrompt=T.Label;FocusedBounds=Screen;}
    }
    if(FocusedKind==TEXT("person"))TalkTargetBody=FocusedTargetId;else NearbyInteraction=FocusedActionId;
}
void UTVBridgeSubsystem::UpdatePlayerShell() {
    auto* PC=GetWorld()->GetFirstPlayerController();auto* P=PC?Cast<ATVCharacter>(PC->GetPawn()):nullptr;if(!PC||!P||!PC->IsLocalController())return;
    if(!PlayerShell){PlayerShell=CreateWidget<UTVPlayerShellWidget>(PC);PlayerShell->OnCommand().AddUObject(this,&UTVBridgeSubsystem::UICommand);
        PlayerShell->OnModalChanged().AddWeakLambda(this,[this](bool Modal){if(auto* C=Cast<ATVCharacter>(UGameplayStatics::GetPlayerCharacter(GetWorld(),0)))C->RefreshInputContext(Modal);});
        PlayerShell->AddToViewport(10);PlayerShell->ActivateWidget();}
    PlayerShell->SetInputActions(P->SemanticActions.FindRef(TEXT("Interact")),P->SemanticActions.FindRef(TEXT("UIBack")));
    MovementRestriction=CanonicalRestriction;
    if(!bTransportConnected||!IsLive())MovementRestriction=TEXT("Reconnecting — movement paused");
    else if(!bControls)MovementRestriction=TEXT("Observer connection — another controller owns this body");
    else if(!bPredictionReady||FPlatformTime::Seconds()-LastLocalStateAt>TVInteractionSpec::inputHorizonSeconds)MovementRestriction=TEXT("Waiting for current movement / collision state");
    else if(PredictedCombat.Locked(CombatAge))MovementRestriction=TEXT("Recovering");
    else if(!HasModalScreen()&&Confirmed.bEligible&&!P->IntentDirection().IsNearlyZero()&&PredictionVelocity.Size2D()<1)MovementRestriction=TEXT("Blocked");
    FTVUISnapshot S;S.Revision=SnapshotCount;S.FocusedLabel=NearbyPrompt;S.FocusedTargetId=FocusedTargetId;S.FocusedActionId=FocusedActionId;
    S.FocusedBounds.bHasFocusBounds=FocusedBounds.bIsValid;S.FocusedBounds.BoundsPixels=FocusedBounds;
    S.Vitals=PlayerVitals+TEXT("\n")+MobilitySummary;S.Restriction=MovementRestriction+(LastResult.IsEmpty()?TEXT(""):TEXT("   ")+LastResult);
    for(int32 I=0;I<InventoryItemIds.Num();++I){FTVUIItemRow Row;Row.Id=InventoryItemIds[I];Row.Label=InventoryItemLabels[I];S.Inventory.Add(Row);}
    for(int32 I=0;I<ContainerItemIds.Num();++I){FTVUIItemRow Row;Row.Id=ContainerItemIds[I];Row.Label=ContainerItemLabels[I];S.Container.Add(Row);}
    S.ContainerId=OpenContainerId;S.ContainerName=OpenContainerName;S.bDialogueOpen=bDialogueOpen;S.DialogueSpeaker=DialogueSpeaker;S.DialogueOccupation=DialogueOccupation;S.DialogueLines=DialogueLines;S.DialogueOptionIds=DialogueOptionIds;S.DialogueOptionLabels=DialogueOptionLabels;
    PlayerShell->SetSnapshot(S);
    if(bDialogueOpen&&!bShellDialogue){if(PlayerShell->HasModalScreen())PlayerShell->CloseTop();PlayerShell->OpenDialogue();}
    bShellDialogue=bDialogueOpen;
    if(!PendingOpenContainer.IsEmpty()&&PendingOpenContainer==OpenContainerId){PendingOpenContainer.Empty();PlayerShell->OpenContainer();}
}
void UTVBridgeSubsystem::UICommand(ETVUICommand Command,const FString& Primary,const FString& Secondary,int32 Index) {
    if(Command==ETVUICommand::Back){if(bDialogueOpen)CloseDialogue();if(PlayerShell&&PlayerShell->HasModalScreen())PlayerShell->CloseTop();return;}
    if(Command==ETVUICommand::Pause){TogglePause();return;}
    if(!IsLive())return;
    if(Command==ETVUICommand::SaveWorld){SaveWorld();return;}
    if(Command==ETVUICommand::Interact){if(Primary==FocusedTargetId&&Secondary==FocusedActionId)Interact();return;}
    auto M=MakeShared<FJsonObject>();
    if(Command==ETVUICommand::DialogueChoice){if(!DialogueOptionIds.Contains(Primary))return;M->SetStringField(TEXT("type"),TEXT("dialogue_option"));M->SetStringField(TEXT("optionId"),Primary);}
    else if(Command==ETVUICommand::DropItem||Command==ETVUICommand::EatItem){M->SetStringField(TEXT("type"),TEXT("interact"));M->SetStringField(TEXT("interactionId"),(Command==ETVUICommand::DropItem?TEXT("drop:"):TEXT("consume:"))+Primary);}
    else {M->SetStringField(TEXT("type"),TEXT("container_transfer"));M->SetStringField(TEXT("containerId"),OpenContainerId);M->SetStringField(TEXT("itemId"),Primary);M->SetStringField(TEXT("direction"),Command==ETVUICommand::TransferItemToContainer?TEXT("into"):TEXT("out"));}
    Send(M);
}
