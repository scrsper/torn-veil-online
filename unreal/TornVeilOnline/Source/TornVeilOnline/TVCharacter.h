#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "TVHumanoidVisualState.h"
#include "TVEmbodiment.h"
#include "TVLocomotionCameraPresentation.h"
#include "TVCharacter.generated.h"

class USpringArmComponent;
class UCameraComponent;
class UTextRenderComponent;
class UAnimationAsset;
class UStaticMeshComponent;
class UMaterialInstanceDynamic;

/** One rendered manifestation. No damage, cognition, schedule or inventory authority. */
UCLASS()
class TORNVEILONLINE_API ATVCharacter : public ACharacter {
    GENERATED_BODY()
public:
    void Mechanisms();
    void SaveWorld();
    void RestToggle();
    void Hush();
    void Meditate();
    void Breakthrough();
    UPROPERTY() TMap<FString, TObjectPtr<UAnimationAsset>> ActivityAnimations;
    void RebasePresentation(const FVector& Delta);
    ATVCharacter();
    virtual void BeginPlay() override;
    virtual void EndPlay(const EEndPlayReason::Type Reason) override;
    virtual void Tick(float DeltaSeconds) override;
    virtual void SetupPlayerInputComponent(UInputComponent* Input) override;
    void SetupEnhancedInput(UInputComponent* Input);
    void RefreshInputContext(bool bModal);
    UPROPERTY() TObjectPtr<class UInputMappingContext> GameplayContext;
    UPROPERTY() TMap<FName,TObjectPtr<class UInputAction>> SemanticActions;
    UPROPERTY(VisibleAnywhere) TObjectPtr<class UTVCombatPresentationComponent> CombatPresentation;
    bool bSemanticCombat = false;
    void Project(const TSharedPtr<class FJsonObject>& Data, bool bFirst);
    void ProjectCombatMotion(const TSharedPtr<class FJsonObject>& Data);
    FString BodyId, EntityId, DisplayName, Activity, CanonicalPose, Occupation, DebugText, AttackTargetEntity;
    /** The class the simulation recognises in this life, and what it read to get there.
     * Empty for most people. Derived canonically; this client only shows it. */
    FString RecognisedClass, ClassEvidence;
    float ClassConfidence = 0;
    bool bDead = false;
    float Health = 100, MaxHealth = 100;
    bool bIncapacitated = false;
    bool bCanonicalPlayer = false;
    /** Hidden because the local camera is inside this body (presentation only). */
    bool bCameraIntrusionHidden = false;
    void HideCameraIntruders();
    UPROPERTY(BlueprintReadOnly, Category="Torn Veil|Presentation") int64 PresentationAttackSeq = 0;
    UPROPERTY(BlueprintReadOnly, Category="Torn Veil|Presentation") int64 PresentationHitSeq = 0;
    UPROPERTY(BlueprintReadOnly, Category="Torn Veil|Presentation") int32 PendingAttackPresentation = 0;
    UPROPERTY(BlueprintReadOnly, Category="Torn Veil|Presentation") int32 PendingHitPresentation = 0;
    UFUNCTION(BlueprintPure, Category="Torn Veil|Presentation") FString PresentationAnimation() const;
    /** Read-only runtime evidence. These observations never feed canonical decisions. */
    UFUNCTION(BlueprintPure, Category="Torn Veil|Presentation") FString PresentationDiagnostics() const;
    FVector IntentDirection() const;
    bool IsSprinting() const { return bSprint; }
    /** The same two handlers the Tab and LMB/X bindings call — reflected so a test can press them
     *  without a mouse. They send intent and nothing else; the simulation still decides whether a
     *  swing reaches anyone, so exposing them grants no authority a player does not already have. */
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input")
    void SelectTarget();
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input")
    void Interact();
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input")
    void Consume();
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input")
    void Drop();
    UFUNCTION(BlueprintCallable,Category="Torn Veil|Input") void Inventory();
    UFUNCTION(BlueprintCallable,Category="Torn Veil|Input") void PauseMenu();
    UFUNCTION(BlueprintCallable,Category="Torn Veil|Input") void UIBack();
    UFUNCTION(BlueprintCallable,Category="Torn Veil|Input") void UIUp();
    UFUNCTION(BlueprintCallable,Category="Torn Veil|Input") void UIDown();
    UFUNCTION(BlueprintCallable,Category="Torn Veil|Input") void UIConfirm();
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input") void Dialogue1();
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input") void Dialogue2();
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input") void Dialogue3();
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input") void Dialogue4();
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input") void Dialogue5();
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input") void Dialogue6();
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input") void Dialogue7();
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input") void Dialogue8();
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input") void Dialogue9();
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input") void CloseDialogue();
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input")
    void Attack();
    UFUNCTION(BlueprintCallable,Category="Torn Veil|Input") void LowAttack();
    UFUNCTION(BlueprintCallable,Category="Torn Veil|Input") void SidestepLeft();
    UFUNCTION(BlueprintCallable,Category="Torn Veil|Input") void SidestepRight();
    UFUNCTION(BlueprintCallable,Category="Torn Veil|Input") void Backstep();
    UFUNCTION(BlueprintCallable,Category="Torn Veil|Input") void Duck();
    UFUNCTION(BlueprintCallable,Category="Torn Veil|Input") void Dodge();
    UFUNCTION(BlueprintCallable,Category="Torn Veil|Input") void PracticePassive();
    UFUNCTION(BlueprintCallable,Category="Torn Veil|Input") void PracticeRepeat();
    UFUNCTION(BlueprintCallable,Category="Torn Veil|Input") void PracticeReset();
    /** The F6 handler. Reflected for the same reason: a developer mode that cannot be entered
     *  from a test is a developer mode nobody checks still works. */
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input")
    void Inspector();
    UPROPERTY(VisibleAnywhere) TObjectPtr<USpringArmComponent> CameraBoom;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UCameraComponent> Camera;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UTextRenderComponent> Nameplate;
    /** Slice 3: the visible human. GetMesh() stays as the hidden animation driver, keeping every
     * existing locomotion/sprint/directional/crouch/combat path intact; this component displays
     * whatever character the palette resolves, sharing the driver pose or retargeting from it. */
    UPROPERTY(VisibleAnywhere) TObjectPtr<UTVCharacterPresentation> VisibleCharacter;
    /** Latest embodiment projection. Presentation-only; nothing here reaches the simulation. */
    FTVEmbodimentState Embodiment;
    bool bHasEmbodiment = false;
private:
    int64 PlayedAttackEvents = 0, PlayedHitEvents = 0;
    int64 SkippedAttackEvents = 0, SkippedHitEvents = 0;
    float MaxChoreographyActorDriftCm = 0;
    /** Renderer-owned attachments. Their palette and shape are derived from the canonical
     * appearance data in Project(); they are never a source of age, identity or occupation. */
    UPROPERTY() TObjectPtr<UStaticMeshComponent> HairProxy;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> GarmentProxy;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> OccupationProp;
    UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> SkinMaterial;
    UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> ClothMaterial;
    UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> HairMaterial;
    UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> PropMaterial;
    UPROPERTY() TObjectPtr<UAnimationAsset> Locomotion;
    UPROPERTY() TObjectPtr<UAnimationAsset> SprintAnimation;
    UPROPERTY() TObjectPtr<class UAnimSequence> LocomotionTransition;
    float LocomotionTransitionAge=99,LastTravelDirection=0;
    bool bDirectionalLocomotion=false;
    UPROPERTY() TObjectPtr<UAnimationAsset> AttackAnimation;
    UPROPERTY() TObjectPtr<UAnimationAsset> HitAnimation;
    UPROPERTY() TObjectPtr<UAnimationAsset> DownAnimation;
    UPROPERTY() TObjectPtr<UAnimationAsset> CurrentAnimation;
    FVector TargetPosition = FVector::ZeroVector, PreviousPosition = FVector::ZeroVector, CanonicalVelocity = FVector::ZeroVector;
    FVector PreviousPresentationVelocity = FVector::ZeroVector;
    float TargetYaw = 0, SnapshotAge = 0, ZoomTarget = 340, ForwardAxis = 0, RightAxis = 0;
    double CombatMotionUntil=0;
    /** Presentation speed derived from the canonical horizontal velocity (Unreal units/s). */
    float CanonicalSpeed = 0;
    /** Canonical timestamps retained for recency/debugging; sequence counters drive replay. */
    float LastAttackAt = -99, LastHitAt = -99, PlayedAttackAt = -99, PlayedHitAt = -99;
    int64 AttackSeq = 0, HitSeq = 0;
    int32 PendingAttackEvents = 0, PendingHitEvents = 0;
    float PresentationAnimationAge = 99.f;
    bool bSprint = false, bProjected = false;
    bool bInputModal=false;
public:
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input")
    void Forward(float Value);
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input")
    void Right(float Value);
private:
    void Turn(float Value); void Look(float Value); void Zoom(float Value);
    void SprintOn(); void SprintOff();
    void Animate(float Speed);
    void AnimateCrouch(float Amount,float Dt);
    void ReleaseCrouch(); void LoseFocus(); void HeavyTrigger(float Value); void PracticePhysiology();
    bool bHeavyTrigger=false; double CanonicalCrouch=0,PreviousCrouch=0;float CrouchTime=0;
    bool bWasChoreography=false,bPresentationTransitionPending=false;float PoseBlendAge=1,LocomotionTime=0,PreviousPresentationYaw=0,PresentationFootPlant=0,CameraShoulderSign=1;
    FTVLocomotionCameraSignal LocomotionCameraSignal;
    UPROPERTY() TMap<FString,TObjectPtr<UAnimationAsset>> CrouchAnimations;
    void ApplyAppearance(const FTVAppearanceVisualState& Appearance);
    /** Applies the bridge's chosen station / conversation ring / separation as a BOUNDED offset on
     * the visible mesh only. The capsule, the camera and every canonical transform stay exactly
     * where the simulation put them, and the player's own body is never offset. */
    void ApplyOccupancyOffset(float Dt);
    FVector OccupancyOffsetCm = FVector::ZeroVector, VisibleMeshBaseLocation = FVector::ZeroVector;
    float OccupancyYawOffsetDegrees = 0.f;
    /** A recognised class is a reading of someone's life, not a badge they wear. A passer-by cannot
     *  see it, so it belongs to the developer inspector rather than to every nameplate in the vale.
     *  -1 means "never applied", so the first call always writes. */
    void ApplyNameplate(bool bShowClass);
    int8 NameplateClassShown = -1;
};
