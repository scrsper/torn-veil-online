#include "TVGameMode.h"
#include "TVCharacter.h"
#include "TVBridgeSubsystem.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Kismet/GameplayStatics.h"
ATVGameMode::ATVGameMode() { DefaultPawnClass = ATVCharacter::StaticClass(); HUDClass = ATVHUD::StaticClass(); }
void ATVHUD::DrawHUD() {
    Super::DrawHUD(); auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>(); if (!B || !Canvas) return;
    DrawRect(FLinearColor(0.015f, 0.02f, 0.035f, 0.85f), 20, 20, 660, 100);
    DrawText(TEXT("TORN VEIL  /  LIVING WORLD"), FLinearColor(0.9f, 0.72f, 0.4f), 36, 30, nullptr, 1.5f);
    DrawText(B->ConnectionStatus(), FLinearColor::White, 36, 65);
    DrawText(TEXT("WASD move  |  Shift run  |  Mouse orbit  |  Wheel zoom  |  Tab target  |  LMB strike  |  E interact  |  C eat  |  Q drop  |  M mechanisms  |  F5 save  |  F6 debug"), FLinearColor(0.7f, 0.75f, 0.8f), 36, 90);
    if(B->bArena) DrawText(TEXT("CONTACT ARENA  |  X/LMB high  |  R low  |  Z/V sidestep  |  Space backstep  |  Left Ctrl duck"), FLinearColor(1,.85f,.5f),36,112);
    if (B->IsLive()) {
        DrawRect(FLinearColor(0.015f, 0.02f, 0.035f, 0.85f), 20, Canvas->SizeY - 150, 660, 85);
        DrawText(B->PlayerVitals, FLinearColor::White, 36, Canvas->SizeY - 140);
        DrawText(B->CarriedSummary, FLinearColor(0.9f, 0.85f, 0.7f), 36, Canvas->SizeY - 118);
        const FString Prompt = (B->NearbyPrompt.IsEmpty() ? FString() : TEXT("E - ") + B->NearbyPrompt)
            + (B->ConsumePrompt.IsEmpty() ? FString() : TEXT("    C - ") + B->ConsumePrompt)
            + (B->DropPrompt.IsEmpty() ? FString() : TEXT("    Q - ") + B->DropPrompt);
        DrawText(Prompt, FLinearColor(1, 0.8f, 0.45f), 36, Canvas->SizeY - 92);
    }
    if (auto* T = B->Selected()) {
        // Occupation is what this person does for a living, and anyone in the vale can see it. A
        // recognised class is a reading of their capability and history that no passer-by could
        // make, so it is developer data: it appears only with the inspector open, alongside the
        // evidence it was read from. The two are deliberately separate and are shown separately.
        const bool bShowClass = B->bInspector && !T->RecognisedClass.IsEmpty();
        DrawRect(FLinearColor(0.02f, 0.02f, 0.03f, 0.9f), 20, 140, 470, B->bInspector ? 270 : 90);
        DrawText(T->DisplayName + TEXT("  /  ") + T->Occupation
            + (bShowClass ? FString::Printf(TEXT("  /  %s (%.0f%%)"), *T->RecognisedClass, T->ClassConfidence * 100) : FString()),
            FLinearColor(1, 0.8f, 0.45f), 36, 150);
        // Condition is read straight off the canonical body. This client never decides that
        // someone is down, and never decides that someone is dead.
        const FString Condition = T->bDead ? TEXT("DEAD") : T->bIncapacitated ? TEXT("DOWNED") : T->Activity;
        const FLinearColor ConditionColour = T->bDead ? FLinearColor(0.85f, 0.3f, 0.3f) : T->bIncapacitated ? FLinearColor(0.95f, 0.7f, 0.35f) : FLinearColor::White;
        DrawText(Condition, ConditionColour, 36, 175);
        DrawText(B->KnowledgeSummary.Left(100), FLinearColor::White, 36, 200);
        if (bShowClass && !T->ClassEvidence.IsEmpty()) DrawText(T->ClassEvidence.Left(96), FLinearColor(0.65f, 0.7f, 0.78f), 36, 200);
        if (B->bInspector) { DrawText(TEXT("DEVELOPER DATA - not character knowledge"), FLinearColor::Yellow, 36, 235); DrawText(T->EntityId + TEXT(" / ") + T->BodyId, FLinearColor::White, 36, 260); DrawText(T->DebugText.Left(240), FLinearColor::White, 36, 285); }
    }
    if(B->bInspector) DrawText(B->ProjectionMetrics,FLinearColor::Yellow,36,420);
    if(B->bMechanismsOpen) {
        const float X=Canvas->SizeX*.45f, Y=150; DrawRect(FLinearColor(.02f,.02f,.03f,.92f),X,Y,520,310);
        DrawText(TEXT("Mechanisms - observed evidence / attempts"),FLinearColor(1,.8f,.45f),X+20,Y+16);
        if(B->MechanismLabels.IsEmpty()) DrawText(TEXT("No visible mechanism in reach."),FLinearColor::White,X+20,Y+50);
        for(int32 I=0;I<FMath::Min(9,B->MechanismLabels.Num());I++) DrawText(FString::Printf(TEXT("%d  %s"),I+1,*B->MechanismLabels[I]),FLinearColor::White,X+20,Y+50+I*25);
    }
    // Why the last intent did not take (out of reach, still recovering) belongs next to the hand
    // that swung, not inside a target panel that may not be open.
    if (!B->LastResult.IsEmpty()) DrawText(B->LastResult, FLinearColor(0.95f, 0.5f, 0.4f), Canvas->SizeX * 0.5f - 60, Canvas->SizeY * 0.5f + 60);
    DrawText(B->LastEvent, FLinearColor(0.9f, 0.85f, 0.7f), 30, Canvas->SizeY - 45);
    if (B->bDialogueOpen) {
        const float X = Canvas->SizeX * 0.17f, W = Canvas->SizeX * 0.66f, Y = Canvas->SizeY * 0.18f;
        const float H = 190.f + B->DialogueLines.Num() * 28.f + B->DialogueOptionLabels.Num() * 25.f;
        DrawRect(FLinearColor(0.018f, 0.014f, 0.025f, 0.96f), X, Y, W, H);
        DrawText(B->DialogueSpeaker + TEXT("  /  ") + B->DialogueOccupation, FLinearColor(1.f, 0.78f, 0.42f), X + 26, Y + 24, nullptr, 1.35f);
        float Cursor = Y + 64.f;
        for (const FString& Line : B->DialogueLines) { DrawText(Line.Left(116), FLinearColor(0.94f, 0.91f, 0.84f), X + 26, Cursor); Cursor += 28.f; }
        Cursor += 12.f;
        for (int32 Index = 0; Index < B->DialogueOptionLabels.Num(); ++Index) {
            DrawText(FString::Printf(TEXT("%d  %s"), Index + 1, *B->DialogueOptionLabels[Index].Left(96)), FLinearColor(0.72f, 0.83f, 0.95f), X + 26, Cursor); Cursor += 25.f;
        }
        DrawText(TEXT("1-9 choose  |  E chooses first  |  Esc closes"), FLinearColor(0.55f, 0.61f, 0.7f), X + 26, Y + H - 30.f);
    }
}
