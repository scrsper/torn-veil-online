#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Character.h"
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
    ATVCharacter();
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
    virtual void SetupPlayerInputComponent(UInputComponent* Input) override;
    void Project(const TSharedPtr<class FJsonObject>& Data, bool bFirst);
    FString BodyId, EntityId, DisplayName, Activity, CanonicalPose, Occupation, DebugText, AttackTargetEntity;
    /** The class the simulation recognises in this life, and what it read to get there.
     * Empty for most people. Derived canonically; this client only shows it. */
    FString RecognisedClass, ClassEvidence;
    float ClassConfidence = 0;
    bool bDead = false;
    float Health = 100, MaxHealth = 100;
    bool bIncapacitated = false;
    bool bCanonicalPlayer = false;
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
    /** The F6 handler. Reflected for the same reason: a developer mode that cannot be entered
     *  from a test is a developer mode nobody checks still works. */
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input")
    void Inspector();
    UPROPERTY(VisibleAnywhere) TObjectPtr<USpringArmComponent> CameraBoom;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UCameraComponent> Camera;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UTextRenderComponent> Nameplate;
private:
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
    UPROPERTY() TObjectPtr<UAnimationAsset> AttackAnimation;
    UPROPERTY() TObjectPtr<UAnimationAsset> HitAnimation;
    UPROPERTY() TObjectPtr<UAnimationAsset> DownAnimation;
    UPROPERTY() TObjectPtr<UAnimationAsset> CurrentAnimation;
    FVector TargetPosition = FVector::ZeroVector, PreviousPosition = FVector::ZeroVector, CanonicalVelocity = FVector::ZeroVector;
    float TargetYaw = 0, SnapshotAge = 0, ZoomTarget = 340, ForwardAxis = 0, RightAxis = 0;
    /** Canonical walk speed (Unreal units/s) and sprint multiplier, both taken from the snapshot. */
    float CanonicalSpeed = 340, CanonicalSprintMultiplier = 1.55f;
    /** Canonical timestamps of this body's last swing and last flinch. A swing lasts 0.45 s and a
     * flinch 0.4 s, so either can begin and end between two snapshots; comparing the timestamp
     * rather than the pose is what lets a second blow replay the montage. */
    float LastAttackAt = -99, LastHitAt = -99, PlayedAttackAt = -99, PlayedHitAt = -99;
    bool bSprint = false, bProjected = false;
public:
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input")
    void Forward(float Value);
    UFUNCTION(BlueprintCallable, Category = "Torn Veil|Input")
    void Right(float Value);
private:
    void Turn(float Value); void Look(float Value); void Zoom(float Value);
    void SprintOn(); void SprintOff();
    void Animate(float Speed);
    void ApplyAppearance(const TSharedPtr<class FJsonObject>& Data);
    /** A recognised class is a reading of someone's life, not a badge they wear. A passer-by cannot
     *  see it, so it belongs to the developer inspector rather than to every nameplate in the vale.
     *  -1 means "never applied", so the first call always writes. */
    void ApplyNameplate(bool bShowClass);
    int8 NameplateClassShown = -1;
};
