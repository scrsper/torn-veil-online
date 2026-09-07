#include "TVGameMode.h"
#include "TVCharacter.h"
#include "TVBridgeSubsystem.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Kismet/GameplayStatics.h"
ATVGameMode::ATVGameMode() { DefaultPawnClass = ATVCharacter::StaticClass(); HUDClass = ATVHUD::StaticClass(); }
void ATVHUD::DrawHUD() {
    Super::DrawHUD(); auto* B = GetWorld()->GetSubsystem<UTVBridgeSubsystem>(); if (!B || !Canvas) return;
    DrawRect(FLinearColor(0.015, 0.02, 0.035, 0.85), 20, 20, 660, 100);
    DrawText(TEXT("TORN VEIL  /  ASHFORD VALE"), FLinearColor(0.9, 0.72, 0.4), 36, 30, nullptr, 1.5);
    DrawText(B->SinceSnapshot < 0.5 ? B->Status : TEXT("Simulation disconnected - movement paused"), FLinearColor::White, 36, 65);
    DrawText(TEXT("WASD move  |  Shift run  |  Mouse orbit  |  Wheel zoom  |  Tab target  |  LMB strike  |  E gather  |  F6 inspect"), FLinearColor(0.7, 0.75, 0.8), 36, 90);
    if (auto* T = B->Selected()) {
        DrawRect(FLinearColor(0.02, 0.02, 0.03, 0.9), 20, 140, 440, B->bInspector ? 270 : 90);
        DrawText(T->DisplayName + TEXT("  /  ") + T->Occupation, FLinearColor(1, 0.8, 0.45), 36, 150);
        // Condition is read straight off the canonical body. This client never decides that
        // someone is down, and never decides that someone is dead.
        const FString Condition = T->bDead ? TEXT("DEAD") : T->bIncapacitated ? TEXT("DOWNED") : T->Activity;
        const FLinearColor ConditionColour = T->bDead ? FLinearColor(0.85, 0.3, 0.3) : T->bIncapacitated ? FLinearColor(0.95, 0.7, 0.35) : FLinearColor::White;
        DrawText(FString::Printf(TEXT("%s  |  %.0f / %.0f health"), *Condition, T->Health, T->MaxHealth), ConditionColour, 36, 175);
        if (B->bInspector) { DrawText(TEXT("DEVELOPER DATA - not character knowledge"), FLinearColor::Yellow, 36, 235); DrawText(T->EntityId + TEXT(" / ") + T->BodyId, FLinearColor::White, 36, 260); DrawText(T->DebugText.Left(240), FLinearColor::White, 36, 285); }
    }
    // Why the last intent did not take (out of reach, still recovering) belongs next to the hand
    // that swung, not inside a target panel that may not be open.
    if (!B->LastResult.IsEmpty()) DrawText(B->LastResult, FLinearColor(0.95, 0.5, 0.4), Canvas->SizeX * 0.5f - 60, Canvas->SizeY * 0.5f + 60);
    DrawText(B->LastEvent, FLinearColor(0.9, 0.85, 0.7), 30, Canvas->SizeY - 45);
}
