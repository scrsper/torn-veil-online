#include "TVEmbodiment.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Engine/SkeletalMesh.h"
#include "Animation/AnimationAsset.h"
#include "Animation/AnimInstance.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "UObject/ConstructorHelpers.h"
#include "UObject/StrongObjectPtr.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Animation/Skeleton.h"

namespace {
    /** Palette lookups load on demand rather than at startup: a village of 127 residents touches
     *  a small fraction of the library, and loading the whole palette would cost memory for
     *  clothing nobody in range is wearing. */
    template <typename T>
    T* LoadPaletteAsset(const TMap<FString, FString>& Paths, const FString& Key) {
        const FString* Path = Paths.Find(Key);
        if (!Path || Path->IsEmpty()) return nullptr;
        return LoadObject<T>(nullptr, **Path);
    }
    FString Lower(const FString& Value) { return Value.ToLower(); }
}

// ---------------------------------------------------------------- bridge parsing

const FTVAppearanceSlot* FTVAppearanceProfile::FindSlot(const TCHAR* Kind) const {
    return Slots.FindByPredicate([Kind](const FTVAppearanceSlot& Slot) { return Slot.Kind == Kind; });
}

bool FTVAppearanceProfile::Parse(const TSharedPtr<FJsonObject>& Json, FTVAppearanceProfile& Out, FString& Error) {
    if (!Json.IsValid()) { Error = TEXT("appearance profile missing"); return false; }
    if (!Json->TryGetStringField(TEXT("personId"), Out.PersonId) || Out.PersonId.IsEmpty()) { Error = TEXT("appearance profile has no personId"); return false; }
    if (!Json->TryGetStringField(TEXT("bodyId"), Out.BodyId) || Out.BodyId.IsEmpty()) { Error = TEXT("appearance profile has no bodyId"); return false; }
    if (!Json->TryGetStringField(TEXT("signature"), Out.Signature) || Out.Signature.IsEmpty()) { Error = TEXT("appearance profile has no signature"); return false; }
    Json->TryGetStringField(TEXT("species"), Out.Species);
    Json->TryGetStringField(TEXT("sex"), Out.Sex);
    Json->TryGetStringField(TEXT("lifeStage"), Out.LifeStage);
    Json->TryGetStringField(TEXT("characterKey"), Out.CharacterKey);
    Json->TryGetBoolField(TEXT("authored"), Out.bAuthored);
    double Value = 1.0;
    if (Json->TryGetNumberField(TEXT("height"), Value)) Out.Height = static_cast<float>(Value);
    if (Json->TryGetNumberField(TEXT("build"), Value)) Out.Build = static_cast<float>(Value);

    const TArray<TSharedPtr<FJsonValue>>* SlotArray = nullptr;
    if (!Json->TryGetArrayField(TEXT("slots"), SlotArray) || SlotArray->Num() == 0) {
        Error = TEXT("appearance profile has no slots"); return false;
    }
    for (const TSharedPtr<FJsonValue>& Entry : *SlotArray) {
        const TSharedPtr<FJsonObject>* Object = nullptr;
        if (!Entry.IsValid() || !Entry->TryGetObject(Object)) continue;
        FTVAppearanceSlot Slot;
        if (!(*Object)->TryGetStringField(TEXT("kind"), Slot.Kind) || Slot.Kind.IsEmpty()) continue;
        if (!(*Object)->TryGetStringField(TEXT("token"), Slot.Token) || Slot.Token.IsEmpty()) continue;
        double Tint = 0;
        Slot.bHasTint = (*Object)->TryGetNumberField(TEXT("tint"), Tint);
        Slot.Tint = static_cast<int64>(Tint);
        Out.Slots.Add(MoveTemp(Slot));
    }
    if (Out.Slots.Num() == 0) { Error = TEXT("appearance profile slots were all malformed"); return false; }
    return true;
}

bool FTVActivityPresentation::Parse(const TSharedPtr<FJsonObject>& Json, FTVActivityPresentation& Out, FString& Error) {
    if (!Json.IsValid()) { Error = TEXT("activity presentation missing"); return false; }
    if (!Json->TryGetStringField(TEXT("family"), Out.Family) || Out.Family.IsEmpty()) { Error = TEXT("activity has no family"); return false; }
    Json->TryGetStringField(TEXT("detail"), Out.Detail);
    Json->TryGetStringField(TEXT("posture"), Out.Posture);
    Json->TryGetStringField(TEXT("locomotion"), Out.Locomotion);
    Json->TryGetStringField(TEXT("station"), Out.Station);
    Json->TryGetStringField(TEXT("placeId"), Out.PlaceId);
    Json->TryGetStringField(TEXT("facingEntityId"), Out.FacingEntityId);
    Json->TryGetStringField(TEXT("carried"), Out.Carried);
    double Value = 0;
    if (Json->TryGetNumberField(TEXT("speed"), Value)) Out.Speed = static_cast<float>(Value);
    const TSharedPtr<FJsonObject>* Injury = nullptr;
    if (Json->TryGetObjectField(TEXT("injury"), Injury) && Injury) {
        (*Injury)->TryGetBoolField(TEXT("impaired"), Out.bImpaired);
        if ((*Injury)->TryGetNumberField(TEXT("severity"), Value)) Out.InjurySeverity = static_cast<float>(Value);
        if ((*Injury)->TryGetNumberField(TEXT("movementMultiplier"), Value)) Out.MovementMultiplier = static_cast<float>(Value);
    }
    return true;
}

bool FTVStationPresentation::Parse(const TSharedPtr<FJsonObject>& Json, FTVStationPresentation& Out) {
    if (!Json.IsValid()) return false;
    if (!Json->TryGetStringField(TEXT("slotId"), Out.SlotId) || Out.SlotId.IsEmpty()) return false;
    Json->TryGetStringField(TEXT("kind"), Out.Kind);
    Json->TryGetStringField(TEXT("posture"), Out.Posture);
    const TSharedPtr<FJsonObject>* Stand = nullptr;
    if (!Json->TryGetObjectField(TEXT("stand"), Stand) || !Stand) return false;
    Out.StandMetres = FVector((*Stand)->GetNumberField(TEXT("x")), (*Stand)->GetNumberField(TEXT("y")), (*Stand)->GetNumberField(TEXT("z")));
    double Value = 0;
    if (Json->TryGetNumberField(TEXT("yaw"), Value)) Out.Yaw = static_cast<float>(Value);
    if (Json->TryGetNumberField(TEXT("settleMetres"), Value)) Out.SettleMetres = static_cast<float>(Value);
    Out.bValid = true;
    return true;
}

bool FTVEmbodimentState::Parse(const TSharedPtr<FJsonObject>& Json, FTVEmbodimentState& Out, FString& Error) {
    if (!Json.IsValid()) { Error = TEXT("embodiment missing"); return false; }
    Json->TryGetStringField(TEXT("appearanceSignature"), Out.AppearanceSignature);
    const TSharedPtr<FJsonObject>* Appearance = nullptr;
    if (Json->TryGetObjectField(TEXT("appearance"), Appearance) && Appearance) {
        Out.bHasAppearance = FTVAppearanceProfile::Parse(*Appearance, Out.Appearance, Error);
        if (!Out.bHasAppearance) return false;
    }
    const TSharedPtr<FJsonObject>* Activity = nullptr;
    if (!Json->TryGetObjectField(TEXT("activity"), Activity) || !Activity) { Error = TEXT("embodiment has no activity"); return false; }
    if (!FTVActivityPresentation::Parse(*Activity, Out.Activity, Error)) return false;

    const TSharedPtr<FJsonObject>* Station = nullptr;
    if (Json->TryGetObjectField(TEXT("station"), Station) && Station) FTVStationPresentation::Parse(*Station, Out.Station);
    const TSharedPtr<FJsonObject>* Separation = nullptr;
    if (Json->TryGetObjectField(TEXT("separation"), Separation) && Separation) {
        Out.Separation = FVector2D((*Separation)->GetNumberField(TEXT("x")), (*Separation)->GetNumberField(TEXT("z")));
    }
    const TSharedPtr<FJsonObject>* Conversation = nullptr;
    if (Json->TryGetObjectField(TEXT("conversation"), Conversation) && Conversation) {
        const TSharedPtr<FJsonObject>* Stand = nullptr;
        if ((*Conversation)->TryGetObjectField(TEXT("stand"), Stand) && Stand) {
            Out.ConversationStandMetres = FVector((*Stand)->GetNumberField(TEXT("x")), (*Stand)->GetNumberField(TEXT("y")), (*Stand)->GetNumberField(TEXT("z")));
            Out.ConversationYaw = static_cast<float>((*Conversation)->GetNumberField(TEXT("yaw")));
            Out.bHasConversation = true;
        }
    }
    return true;
}

// ---------------------------------------------------------------- palette

UTVCharacterPalette* UTVCharacterPalette::Get() {
    static TStrongObjectPtr<UTVCharacterPalette> Instance;
    if (!Instance.IsValid()) {
        Instance.Reset(NewObject<UTVCharacterPalette>(GetTransientPackage(), UTVCharacterPalette::StaticClass()));
        Instance->Reload();
    }
    return Instance.Get();
}

bool UTVCharacterPalette::Reload() {
    AuthoredPaths.Reset(); BodyPaths.Reset(); PartPaths.Reset();
    ActivityPaths.Reset(); RetargetClassPaths.Reset(); DriverSkeletons.Reset();
    UnresolvedTokens.Reset(); MissingLookups = 0; bLoaded = false;
    SourceFile = FPaths::ProjectContentDir() / TEXT("TornVeil/Presentation/CharacterPalette.json");
    FString Text;
    if (!FFileHelper::LoadFileToString(Text, *SourceFile)) {
        UE_LOG(LogTemp, Warning, TEXT("TV_EMBODIMENT no character palette at %s; characters keep the driver silhouette"), *SourceFile);
        return false;
    }
    TSharedPtr<FJsonObject> Root;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
    if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid()) {
        UE_LOG(LogTemp, Error, TEXT("TV_EMBODIMENT character palette at %s is not valid JSON"), *SourceFile);
        return false;
    }
    Ingest(Root);
    bLoaded = true;
    return true;
}

void UTVCharacterPalette::Ingest(const TSharedPtr<FJsonObject>& Root) {
    const auto ReadMap = [&Root](const TCHAR* Field, TMap<FString, FString>& Into, const FString& Prefix) {
        const TSharedPtr<FJsonObject>* Section = nullptr;
        if (!Root->TryGetObjectField(Field, Section) || !Section) return;
        for (const auto& Pair : (*Section)->Values) {
            FString Path;
            if (Pair.Value.IsValid() && Pair.Value->TryGetString(Path) && !Path.IsEmpty()) {
                Into.Add(Prefix + Lower(Pair.Key), Path);
            }
        }
    };
    ReadMap(TEXT("authored"), AuthoredPaths, FString());
    ReadMap(TEXT("bodies"), BodyPaths, FString());
    ReadMap(TEXT("activities"), ActivityPaths, FString());
    ReadMap(TEXT("retargets"), RetargetClassPaths, FString());

    // `parts` is nested by slot kind so the same token may mean different things in two slots.
    const TSharedPtr<FJsonObject>* PartSection = nullptr;
    if (Root->TryGetObjectField(TEXT("parts"), PartSection) && PartSection) {
        for (const auto& KindPair : (*PartSection)->Values) {
            const TSharedPtr<FJsonObject>* Tokens = nullptr;
            if (!KindPair.Value.IsValid() || !KindPair.Value->TryGetObject(Tokens) || !Tokens) continue;
            for (const auto& TokenPair : (*Tokens)->Values) {
                FString Path;
                if (TokenPair.Value.IsValid() && TokenPair.Value->TryGetString(Path) && !Path.IsEmpty()) {
                    PartPaths.Add(Lower(KindPair.Key) + TEXT("/") + Lower(TokenPair.Key), Path);
                }
            }
        }
    }
    const TArray<TSharedPtr<FJsonValue>>* Shared = nullptr;
    if (Root->TryGetArrayField(TEXT("driverSkeletons"), Shared)) {
        for (const TSharedPtr<FJsonValue>& Entry : *Shared) {
            FString Name;
            if (Entry.IsValid() && Entry->TryGetString(Name) && !Name.IsEmpty()) DriverSkeletons.Add(Lower(Name));
        }
    }
}

USkeletalMesh* UTVCharacterPalette::AuthoredMesh(const FString& CharacterKey) const {
    if (CharacterKey.IsEmpty()) return nullptr;
    USkeletalMesh* Mesh = LoadPaletteAsset<USkeletalMesh>(AuthoredPaths, Lower(CharacterKey));
    if (!Mesh) UnresolvedTokens.Add(TEXT("authored/") + Lower(CharacterKey));
    return Mesh;
}

USkeletalMesh* UTVCharacterPalette::BodyMesh(const FString& Token) const {
    if (Token.IsEmpty()) return nullptr;
    USkeletalMesh* Mesh = LoadPaletteAsset<USkeletalMesh>(BodyPaths, Lower(Token));
    if (!Mesh) UnresolvedTokens.Add(TEXT("body/") + Lower(Token));
    return Mesh;
}

USkeletalMesh* UTVCharacterPalette::PartMesh(const FString& Kind, const FString& Token) const {
    if (Kind.IsEmpty() || Token.IsEmpty()) return nullptr;
    const FString Key = Lower(Kind) + TEXT("/") + Lower(Token);
    USkeletalMesh* Mesh = LoadPaletteAsset<USkeletalMesh>(PartPaths, Key);
    if (!Mesh) UnresolvedTokens.Add(Key);
    return Mesh;
}

UAnimationAsset* UTVCharacterPalette::ActivityAnimation(const FString& Family, const FString& Detail) const {
    if (Family.IsEmpty()) return nullptr;
    if (!Detail.IsEmpty()) {
        if (UAnimationAsset* Exact = LoadPaletteAsset<UAnimationAsset>(ActivityPaths, Lower(Family) + TEXT("/") + Lower(Detail))) return Exact;
    }
    UAnimationAsset* Generic = LoadPaletteAsset<UAnimationAsset>(ActivityPaths, Lower(Family));
    if (!Generic) UnresolvedTokens.Add(TEXT("activity/") + Lower(Family));
    return Generic;
}

UClass* UTVCharacterPalette::RetargetAnimClass(const FString& SkeletonKey) const {
    const FString* Path = RetargetClassPaths.Find(Lower(SkeletonKey));
    if (!Path || Path->IsEmpty()) return nullptr;
    // The palette stores the generated class path of an animation blueprint whose graph contains a
    // Retarget Pose From Mesh node pointing at the driver. Authoring that blueprint is the Python
    // tool's job (`unreal/scripts/build_character_retarget.py`); C++ only selects it.
    return LoadObject<UClass>(nullptr, **Path);
}

bool UTVCharacterPalette::SharesDriverSkeleton(const FString& SkeletonKey) const {
    return DriverSkeletons.Contains(Lower(SkeletonKey));
}

FString UTVCharacterPalette::PaletteDiagnostics() const {
    TArray<FString> Unresolved = UnresolvedTokens.Array();
    Unresolved.Sort();
    for (FString& Token : Unresolved) Token = FString::Printf(TEXT("\"%s\""), *Token);
    return FString::Printf(
        TEXT("{\"loaded\":%s,\"source\":\"%s\",\"authored\":%d,\"bodies\":%d,\"parts\":%d,\"activities\":%d,\"retargets\":%d,\"unresolved\":[%s]}"),
        bLoaded ? TEXT("true") : TEXT("false"), *SourceFile,
        AuthoredPaths.Num(), BodyPaths.Num(), PartPaths.Num(), ActivityPaths.Num(), RetargetClassPaths.Num(),
        *FString::Join(Unresolved, TEXT(",")));
}

// ---------------------------------------------------------------- visible presentation

UTVCharacterPresentation::UTVCharacterPresentation() {
    PrimaryComponentTick.bCanEverTick = false;
    SetCollisionEnabled(ECollisionEnabled::NoCollision);
    SetGenerateOverlapEvents(false);
    // A canonically visible body must finish its presentation even while camera-culled, exactly
    // as the driver already does — otherwise a character walking back into frame pops.
    VisibilityBasedAnimTickOption = EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones;
}

void UTVCharacterPresentation::BindDriver(USkeletalMeshComponent* Driver) {
    if (!Driver || DriverMesh == Driver) return;
    DriverMesh = Driver;
    SetRelativeTransform(FTransform::Identity);
    // The driver keeps evaluating: it is what produces the pose this component displays, and what
    // every existing locomotion/combat/crouch path in ATVCharacter already drives.
    Driver->VisibilityBasedAnimTickOption = EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones;
}

void UTVCharacterPresentation::ClearParts() {
    for (TObjectPtr<USkeletalMeshComponent>& Part : Parts) {
        if (Part) { Part->DestroyComponent(); }
    }
    Parts.Reset();
    PartSlotKinds.Reset();
    ResolvedPartCount = 0;
}

bool UTVCharacterPresentation::ApplyProfile(const FTVAppearanceProfile& Profile) {
    if (Profile.Signature.IsEmpty() || Profile.Signature == AppliedSignature) return false;
    AppliedSignature = Profile.Signature;
    ResolvedCharacterKey = Profile.CharacterKey;
    UnresolvedSlotCount = 0;
    ClearParts();

    UTVCharacterPalette* Palette = UTVCharacterPalette::Get();
    USkeletalMesh* Visible = Profile.bAuthored ? Palette->AuthoredMesh(Profile.CharacterKey) : nullptr;
    if (!Visible) {
        // An authored character with no installed asset degrades to its modular parts rather than
        // to nothing — the slots are always emitted for exactly this case.
        if (const FTVAppearanceSlot* Body = Profile.FindSlot(TEXT("body"))) Visible = Palette->BodyMesh(Body->Token);
    }

    bVisibleCharacter = Visible != nullptr;
    if (!bVisibleCharacter) {
        // Nothing resolved. Keep the driver visible and say so; a white mannequin is a truthful
        // "content not installed", and a silently invisible character is not.
        SetSkeletalMesh(nullptr);
        SetVisibility(false);
        if (DriverMesh) DriverMesh->SetVisibility(true);
        return true;
    }

    SetSkeletalMesh(Visible);
    SetVisibility(true);
    if (DriverMesh) DriverMesh->SetVisibility(false);

    const FString SkeletonKey = Visible->GetSkeleton() ? Visible->GetSkeleton()->GetPathName() : FString();
    bRetargeted = false;
    if (Palette->SharesDriverSkeleton(SkeletonKey)) {
        // Same skeleton as the driver: share the evaluated pose outright. No second animation
        // evaluation, and no duplicated animation library.
        SetAnimInstanceClass(nullptr);
        SetLeaderPoseComponent(DriverMesh);
    } else if (UClass* Retarget = Palette->RetargetAnimClass(SkeletonKey)) {
        // Another humanoid skeleton: run the retarget animation blueprint, whose Retarget Pose
        // From Mesh node reads this same driver through an IK Retargeter.
        SetLeaderPoseComponent(nullptr);
        SetAnimInstanceClass(Retarget);
        bRetargeted = true;
    } else {
        // A visible skeleton the palette describes neither way cannot be driven. Fall back to the
        // driver silhouette rather than draw a T-posing character.
        UE_LOG(LogTemp, Warning, TEXT("TV_EMBODIMENT no pose source for skeleton %s; keeping driver silhouette"), *SkeletonKey);
        SetSkeletalMesh(nullptr); SetVisibility(false);
        if (DriverMesh) DriverMesh->SetVisibility(true);
        bVisibleCharacter = false;
        return true;
    }

    for (const FTVAppearanceSlot& Slot : Profile.Slots) {
        if (Slot.Kind == TEXT("body") || Slot.Kind == TEXT("skin")) continue;
        USkeletalMesh* PartMesh = Palette->PartMesh(Slot.Kind, Slot.Token);
        if (!PartMesh) { ++UnresolvedSlotCount; continue; }
        USkeletalMeshComponent* Part = NewObject<USkeletalMeshComponent>(GetOwner());
        Part->SetupAttachment(this);
        Part->RegisterComponent();
        Part->SetSkeletalMesh(PartMesh);
        Part->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Part->VisibilityBasedAnimTickOption = EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones;
        // One evaluation for the whole outfit: every part follows the visible body's pose.
        Part->SetLeaderPoseComponent(this);
        Parts.Add(Part);
        PartSlotKinds.Add(Slot.Kind);
        ++ResolvedPartCount;
    }

    const float Build = FMath::Clamp(Profile.Build, .7f, 1.4f), Height = FMath::Clamp(Profile.Height, .3f, 1.4f);
    SetRelativeScale3D(FVector(Build, Build, Height));
    ApplyTints(Profile);
    return true;
}

void UTVCharacterPresentation::ApplyTints(const FTVAppearanceProfile& Profile) {
    const auto Colour = [](int64 Hex) {
        return FLinearColor(FColor(static_cast<uint8>((Hex >> 16) & 0xff), static_cast<uint8>((Hex >> 8) & 0xff), static_cast<uint8>(Hex & 0xff)));
    };
    for (const FTVAppearanceSlot& Slot : Profile.Slots) {
        if (!Slot.bHasTint) continue;
        // Skin and body tints drive the visible body; everything else drives its own part.
        USkeletalMeshComponent* Target = this;
        if (Slot.Kind != TEXT("skin") && Slot.Kind != TEXT("body")) {
            const int32 Index = PartSlotKinds.IndexOfByKey(Slot.Kind);
            Target = Parts.IsValidIndex(Index) ? Parts[Index].Get() : nullptr;
        }
        if (!Target) continue;
        for (int32 Material = 0; Material < Target->GetNumMaterials(); ++Material) {
            if (UMaterialInstanceDynamic* Dynamic = Target->CreateAndSetMaterialInstanceDynamic(Material)) {
                Dynamic->SetVectorParameterValue(TEXT("Tint"), Colour(Slot.Tint));
            }
        }
    }
}

FString UTVCharacterPresentation::EmbodimentDiagnostics() const {
    return FString::Printf(
        TEXT("{\"signature\":\"%s\",\"characterKey\":\"%s\",\"visibleCharacter\":%s,\"retargeted\":%s,\"parts\":%d,\"unresolvedSlots\":%d}"),
        *AppliedSignature, *ResolvedCharacterKey,
        bVisibleCharacter ? TEXT("true") : TEXT("false"),
        bRetargeted ? TEXT("true") : TEXT("false"),
        ResolvedPartCount, UnresolvedSlotCount);
}
