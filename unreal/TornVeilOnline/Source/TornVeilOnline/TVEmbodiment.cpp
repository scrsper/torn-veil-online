#include "TVEmbodiment.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Engine/SkeletalMesh.h"
#include "Animation/AnimationAsset.h"
#include "Animation/AnimInstance.h"
#include "Animation/Skeleton.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "UObject/StrongObjectPtr.h"
#include "GroomComponent.h"
#include "GroomAsset.h"
#include "GroomBindingAsset.h"

namespace {
    FString Lower(const FString& Value) { return Value.ToLower(); }
    FString PackageKey(const FString& Value) { return Value.Left(Value.Find(TEXT(".")) == INDEX_NONE ? Value.Len() : Value.Find(TEXT("."))).ToLower(); }

    template <typename T>
    T* LoadMappedAsset(const TMap<FString, FString>& Paths, const FString& Key) {
        const FString* Path = Paths.Find(Lower(Key));
        return Path && !Path->IsEmpty() ? LoadObject<T>(nullptr, **Path) : nullptr;
    }

    FString FoundryObjectPath(const FTVFoundrySlot& Slot) {
        if (Slot.Package.Contains(TEXT("."))) return Slot.Package;
        const FString ObjectName = Slot.Name.IsEmpty() ? FPaths::GetBaseFilename(Slot.Package) : Slot.Name;
        return Slot.Package + TEXT(".") + ObjectName;
    }

    template <typename T>
    T* LoadFoundryAsset(const FTVFoundrySlot& Slot) {
        const FString Path = FoundryObjectPath(Slot);
        return LoadObject<T>(nullptr, *Path);
    }

    FLinearColor Colour(int64 Hex) {
        return FLinearColor(FColor(
            static_cast<uint8>((Hex >> 16) & 0xff),
            static_cast<uint8>((Hex >> 8) & 0xff),
            static_cast<uint8>(Hex & 0xff)));
    }

    /**
     * The project's own character master materials, which are the only ones that declare `Tint`.
     *
     * Tinting whatever material a mesh happened to ship with does not work and does not complain:
     * `SetVectorParameterValue` on a parameter the material does not declare is a silent no-op, so
     * a vendor mannequin stays exactly as white as it came while the canonical colour is computed,
     * sent across the bridge and dropped on the floor. Swapping in a material that declares the
     * parameter is what makes canonical appearance actually reach a pixel.
     */
    UMaterialInterface* CharacterMaterial(const TCHAR* Name) {
        static TMap<FString, TWeakObjectPtr<UMaterialInterface>> Cache;
        if (TWeakObjectPtr<UMaterialInterface>* Found = Cache.Find(Name)) {
            if (Found->IsValid()) return Found->Get();
        }
        UMaterialInterface* Loaded = LoadObject<UMaterialInterface>(
            nullptr, *FString::Printf(TEXT("/Game/TornVeil/Materials/%s.%s"), Name, Name));
        Cache.Add(Name, Loaded);
        return Loaded;
    }

    /** @param Accent The costume family's accent colour, pushed alongside the slot's own tint.
     *
     * A garment is not one colour. Every Ashford reference figure wears a dark ground with one
     * saturated accent at the collar and the waist, and the canonical palette already carries
     * both (`GarmentPrimary` and `GarmentAccent`) -- the presentation layer was simply throwing
     * the second one away for every slot that was not an accessory. The Ashford cloth shader
     * masks the two apart with vertex colour, so one mesh and one material instance give a muted
     * indigo kosode with a vermilion collar without authoring that combination as an asset.
     *
     * Inert for every other material in the project: a shader with no `Accent` parameter ignores
     * the write, exactly as vendor shaders already ignore `Tint`.
     */
    void TintComponent(USkeletalMeshComponent* Component, const TCHAR* MaterialName, int64 Hex, int64 Accent, float Wear, float Grooming) {
        if (!Component) return;
        // Plain project shaders belong only on placeholder mannequins. Replacing a vendor's
        // skin/cloth shader discards its textures, normals, masks and subsurface response.
        const USkeletalMesh* Mesh = Component->GetSkeletalMeshAsset();
        const bool bPlaceholder = Mesh && (Mesh->GetName().StartsWith(TEXT("SKM_Manny"))
            || Mesh->GetName().StartsWith(TEXT("SKM_Quinn")) || Mesh->GetName() == TEXT("SKM_UEFN_Mannequin"));
        UMaterialInterface* Base = bPlaceholder ? CharacterMaterial(MaterialName) : nullptr;
        for (int32 Index = 0; Index < Component->GetNumMaterials(); ++Index) {
            // Fall back to tinting the mesh's own material when the project material is missing:
            // an untinted character is a far better outcome than an invisible one.
            UMaterialInstanceDynamic* Dynamic = Base
                ? UMaterialInstanceDynamic::Create(Base, Component)
                : Component->CreateAndSetMaterialInstanceDynamic(Index);
            if (!Dynamic) continue;
            if (Base) Component->SetMaterial(Index, Dynamic);
            Dynamic->SetVectorParameterValue(TEXT("Tint"), Colour(Hex));
            Dynamic->SetVectorParameterValue(TEXT("Accent"), Colour(Accent));
            Dynamic->SetScalarParameterValue(TEXT("Wear"), Wear);
            Dynamic->SetScalarParameterValue(TEXT("Grooming"), Grooming);
        }
    }

    /** Give the body the complexion of the face that was put on it.
     *
     * MetaHuman-derived crowd content does not ship a skin texture per character: every head and
     * body material instance points `Color_MAIN` at the same shared `DefaultTexture_VT` and picks
     * a row out of an atlas with an `AtlasSelector` scalar. The head instances carry their
     * identity's index (0-5 per sex); the shipped body instances sit at 0 because the vendor's own
     * crowd Blueprint assigns them at spawn. Assembling a body and a head straight from the
     * catalogue therefore gives everyone but identity 0 a different complexion from their own neck
     * and hands -- which is what PIE showed, and it is the first thing the eye catches.
     *
     * The index is read back off the vendor head material rather than tabulated in the audit, so a
     * pack that ships more identities needs no new catalogue data, and a head with no such
     * parameter at all (Polytope, Quantum) leaves the body untouched.
     */
    void MatchBodyComplexionToFace(USkeletalMeshComponent* Body, USkeletalMeshComponent* Face) {
        if (!Body || !Face) return;
        const UMaterialInterface* FaceMaterial = Face->GetMaterial(0);
        float Atlas = 0.f;
        if (!FaceMaterial || !FaceMaterial->GetScalarParameterValue(
                FHashedMaterialParameterInfo(TEXT("AtlasSelector")), Atlas)) {
            return;
        }
        for (int32 Index = 0; Index < Body->GetNumMaterials(); ++Index) {
            const UMaterialInterface* Current = Body->GetMaterial(Index);
            float Existing = 0.f;
            // Only a slot that actually exposes the parameter is worth a dynamic instance.
            if (!Current || !Current->GetScalarParameterValue(
                    FHashedMaterialParameterInfo(TEXT("AtlasSelector")), Existing)) {
                continue;
            }
            if (UMaterialInstanceDynamic* Dynamic = Body->CreateAndSetMaterialInstanceDynamic(Index)) {
                Dynamic->SetScalarParameterValue(TEXT("AtlasSelector"), Atlas);
            }
        }
    }
}

// ---------------------------------------------------------------- bridge parsing

const FTVFoundrySlot* FTVAppearanceProfile::FindSlot(const TCHAR* SlotName) const {
    return Slots.FindByPredicate([SlotName](const FTVFoundrySlot& Candidate) { return Candidate.Slot == SlotName; });
}

bool FTVAppearanceProfile::Parse(const TSharedPtr<FJsonObject>& Json, FTVAppearanceProfile& Out, FString& Error) {
    if (!Json.IsValid()) { Error = TEXT("appearance profile missing"); return false; }
    if (!Json->TryGetStringField(TEXT("personId"), Out.PersonId) || Out.PersonId.IsEmpty()) { Error = TEXT("appearance profile has no personId"); return false; }
    if (!Json->TryGetStringField(TEXT("bodyId"), Out.BodyId) || Out.BodyId.IsEmpty()) { Error = TEXT("appearance profile has no bodyId"); return false; }
    if (!Json->TryGetStringField(TEXT("signature"), Out.Signature) || Out.Signature.IsEmpty()) { Error = TEXT("appearance profile has no signature"); return false; }

    // Requiring the projected description makes the wire contract explicit: the realization is a
    // projection of canonical appearance, not a second renderer-authored answer.
    const TSharedPtr<FJsonObject>* Description = nullptr;
    if (!Json->TryGetObjectField(TEXT("description"), Description) || !Description) { Error = TEXT("appearance profile has no canonical description"); return false; }

    const TSharedPtr<FJsonObject>* Realization = nullptr;
    if (!Json->TryGetObjectField(TEXT("realization"), Realization) || !Realization) { Error = TEXT("appearance profile has no Foundry realization"); return false; }
    FString EntityId;
    if (!(*Realization)->TryGetStringField(TEXT("entityId"), EntityId) || EntityId != Out.PersonId) { Error = TEXT("Foundry realization identity mismatch"); return false; }
    (*Realization)->TryGetStringField(TEXT("skeleton"), Out.Skeleton);
    (*Realization)->TryGetBoolField(TEXT("complete"), Out.bComplete);

    double Value = 0.0;
    const TSharedPtr<FJsonObject>* Scale = nullptr;
    if ((*Realization)->TryGetObjectField(TEXT("scale"), Scale) && Scale) {
        if ((*Scale)->TryGetNumberField(TEXT("height"), Value)) Out.Height = static_cast<float>(Value);
        if ((*Scale)->TryGetNumberField(TEXT("build"), Value)) Out.Build = static_cast<float>(Value);
    }
    const TSharedPtr<FJsonObject>* Materials = nullptr;
    if ((*Realization)->TryGetObjectField(TEXT("materials"), Materials) && Materials) {
        if ((*Materials)->TryGetNumberField(TEXT("skin"), Value)) Out.Materials.Skin = static_cast<int64>(Value);
        if ((*Materials)->TryGetNumberField(TEXT("hair"), Value)) Out.Materials.Hair = static_cast<int64>(Value);
        if ((*Materials)->TryGetNumberField(TEXT("garmentPrimary"), Value)) Out.Materials.GarmentPrimary = static_cast<int64>(Value);
        if ((*Materials)->TryGetNumberField(TEXT("garmentSecondary"), Value)) Out.Materials.GarmentSecondary = static_cast<int64>(Value);
        if ((*Materials)->TryGetNumberField(TEXT("garmentAccent"), Value)) Out.Materials.GarmentAccent = static_cast<int64>(Value);
        if ((*Materials)->TryGetNumberField(TEXT("wear"), Value)) Out.Materials.Wear = static_cast<float>(Value);
        if ((*Materials)->TryGetNumberField(TEXT("grooming"), Value)) Out.Materials.Grooming = static_cast<float>(Value);
    }
    const TSharedPtr<FJsonObject>* Morphs = nullptr;
    if ((*Realization)->TryGetObjectField(TEXT("morphs"), Morphs) && Morphs) {
        for (const auto& Pair : (*Morphs)->Values) {
            double Morph = 0.0;
            if (Pair.Value.IsValid() && Pair.Value->TryGetNumber(Morph)) Out.Morphs.Add(FString(Pair.Key.ToView()), static_cast<float>(Morph));
        }
    }

    const TArray<TSharedPtr<FJsonValue>>* SlotArray = nullptr;
    if ((*Realization)->TryGetArrayField(TEXT("slots"), SlotArray)) {
        for (const TSharedPtr<FJsonValue>& Entry : *SlotArray) {
            const TSharedPtr<FJsonObject>* Object = nullptr;
            if (!Entry.IsValid() || !Entry->TryGetObject(Object) || !Object) continue;
            FTVFoundrySlot Slot;
            if (!(*Object)->TryGetStringField(TEXT("slot"), Slot.Slot) || Slot.Slot.IsEmpty()) continue;
            if (!(*Object)->TryGetStringField(TEXT("package"), Slot.Package) || !Slot.Package.StartsWith(TEXT("/"))) continue;
            (*Object)->TryGetStringField(TEXT("name"), Slot.Name);
            (*Object)->TryGetStringField(TEXT("assetClass"), Slot.AssetClass);
            const TArray<TSharedPtr<FJsonValue>>* MaterialSlots = nullptr;
            if ((*Object)->TryGetArrayField(TEXT("materialSlots"), MaterialSlots)) {
                for (const TSharedPtr<FJsonValue>& Material : *MaterialSlots) {
                    FString Name;
                    if (Material.IsValid() && Material->TryGetString(Name)) Slot.MaterialSlots.Add(Name);
                }
            }
            Out.Slots.Add(MoveTemp(Slot));
        }
    }
    const TArray<TSharedPtr<FJsonValue>>* Problems = nullptr;
    if ((*Realization)->TryGetArrayField(TEXT("problems"), Problems)) Out.ProblemCount = Problems->Num();
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

// ---------------------------------------------------------------- local activity / retarget support

UTVCharacterPalette* UTVCharacterPalette::Get() {
    static TStrongObjectPtr<UTVCharacterPalette> Instance;
    if (!Instance.IsValid()) {
        Instance.Reset(NewObject<UTVCharacterPalette>(GetTransientPackage(), UTVCharacterPalette::StaticClass()));
        Instance->Reload();
    }
    return Instance.Get();
}

bool UTVCharacterPalette::Reload() {
    ActivityPaths.Reset(); RetargetClassPaths.Reset(); DriverSkeletons.Reset();
    GroomBindingPaths.Reset(); BodyMaterialPaths.Reset();
    UnresolvedTokens.Reset(); bLoaded = false;
    SourceFile = FPaths::ProjectContentDir() / TEXT("TornVeil/Presentation/CharacterPalette.json");
    const FString LocalFile = FPaths::ProjectContentDir() / TEXT("TornVeil/Presentation/CharacterPalette.local.json");
    if (FPaths::FileExists(LocalFile)) SourceFile = LocalFile;
    FString Text;
    if (!FFileHelper::LoadFileToString(Text, *SourceFile)) {
        UE_LOG(LogTemp, Warning, TEXT("TV_EMBODIMENT no activity/retarget palette at %s"), *SourceFile);
        return false;
    }
    TSharedPtr<FJsonObject> Root;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
    if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid()) {
        UE_LOG(LogTemp, Error, TEXT("TV_EMBODIMENT palette at %s is not valid JSON"), *SourceFile);
        return false;
    }
    Ingest(Root);
    bLoaded = true;
    return true;
}

void UTVCharacterPalette::Ingest(const TSharedPtr<FJsonObject>& Root) {
    const auto ReadMap = [&Root](const TCHAR* Field, TMap<FString, FString>& Into) {
        const TSharedPtr<FJsonObject>* Section = nullptr;
        if (!Root->TryGetObjectField(Field, Section) || !Section) return;
        for (const auto& Pair : (*Section)->Values) {
            FString Path;
            if (Pair.Value.IsValid() && Pair.Value->TryGetString(Path) && !Path.IsEmpty()) Into.Add(Lower(FString(Pair.Key.ToView())), Path);
        }
    };
    ReadMap(TEXT("activities"), ActivityPaths);
    ReadMap(TEXT("retargets"), RetargetClassPaths);
    ReadMap(TEXT("groomBindings"), GroomBindingPaths);
    ReadMap(TEXT("bodyMaterials"), BodyMaterialPaths);
    const TArray<TSharedPtr<FJsonValue>>* Shared = nullptr;
    if (Root->TryGetArrayField(TEXT("driverSkeletons"), Shared)) {
        for (const TSharedPtr<FJsonValue>& Entry : *Shared) {
            FString Name;
            if (Entry.IsValid() && Entry->TryGetString(Name) && !Name.IsEmpty()) DriverSkeletons.Add(Lower(Name));
        }
    }
}

UAnimationAsset* UTVCharacterPalette::ActivityAnimation(const FString& Family, const FString& Detail) const {
    if (Family.IsEmpty()) return nullptr;
    if (!Detail.IsEmpty()) {
        if (UAnimationAsset* Exact = LoadMappedAsset<UAnimationAsset>(ActivityPaths, Family + TEXT("/") + Detail)) return Exact;
    }
    UAnimationAsset* Generic = LoadMappedAsset<UAnimationAsset>(ActivityPaths, Family);
    if (!Generic) UnresolvedTokens.Add(TEXT("activity/") + Lower(Family));
    return Generic;
}

UClass* UTVCharacterPalette::RetargetAnimClass(const FString& SkeletonKey) const {
    if (UClass* Exact = LoadMappedAsset<UClass>(RetargetClassPaths, SkeletonKey)) return Exact;
    return LoadMappedAsset<UClass>(RetargetClassPaths, PackageKey(SkeletonKey));
}

UGroomBindingAsset* UTVCharacterPalette::GroomBinding(UGroomAsset* Groom, USkeletalMesh* Face) const {
    if (!Groom || !Face) return nullptr;
    UGroomBindingAsset* Binding = LoadMappedAsset<UGroomBindingAsset>(GroomBindingPaths,
        PackageKey(Groom->GetPathName()) + TEXT("|") + PackageKey(Face->GetPathName()));
    return Binding && Binding->GetGroom() == Groom && Binding->GetTargetSkeletalMesh() == Face ? Binding : nullptr;
}

UMaterialInterface* UTVCharacterPalette::BodyMaterial(const FString& HeadPackage) const {
    return LoadMappedAsset<UMaterialInterface>(BodyMaterialPaths, PackageKey(HeadPackage));
}

bool UTVCharacterPalette::SharesDriverSkeleton(const FString& SkeletonKey) const {
    const FString Key = Lower(SkeletonKey);
    FString PackageKey = Key;
    int32 Dot = INDEX_NONE;
    if (PackageKey.FindChar(TEXT('.'), Dot)) PackageKey.LeftInline(Dot);
    return DriverSkeletons.Contains(Key) || DriverSkeletons.Contains(PackageKey);
}

FString UTVCharacterPalette::PaletteDiagnostics() const {
    TArray<FString> Unresolved = UnresolvedTokens.Array();
    Unresolved.Sort();
    for (FString& Token : Unresolved) Token = FString::Printf(TEXT("\"%s\""), *Token);
    return FString::Printf(TEXT("{\"loaded\":%s,\"source\":\"%s\",\"activities\":%d,\"retargets\":%d,\"unresolved\":[%s]}"),
        bLoaded ? TEXT("true") : TEXT("false"), *SourceFile, ActivityPaths.Num(), RetargetClassPaths.Num(), *FString::Join(Unresolved, TEXT(",")));
}

// ---------------------------------------------------------------- visible presentation

UTVCharacterPresentation::UTVCharacterPresentation() {
    PrimaryComponentTick.bCanEverTick = true;
    SetCollisionEnabled(ECollisionEnabled::NoCollision);
    SetGenerateOverlapEvents(false);
    VisibilityBasedAnimTickOption = EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones;
}

void UTVCharacterPresentation::BindDriver(USkeletalMeshComponent* Driver) {
    if (!Driver || DriverMesh == Driver) return;
    DriverMesh = Driver;
    AttachToComponent(Driver, FAttachmentTransformRules::SnapToTargetNotIncludingScale);
    SetRelativeTransform(FTransform::Identity);
    AddTickPrerequisiteComponent(Driver);
    Driver->VisibilityBasedAnimTickOption = EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones;
}

void UTVCharacterPresentation::ClearParts() {
    for (TObjectPtr<UGroomComponent>& Groom : Grooms) if (Groom) Groom->DestroyComponent();
    Grooms.Reset();
    for (TObjectPtr<USkeletalMeshComponent>& Part : Parts) if (Part) Part->DestroyComponent();
    Parts.Reset();
    PartSlotKinds.Reset();
    ResolvedPartCount = 0;
}

bool UTVCharacterPresentation::ApplyProfile(const FTVAppearanceProfile& Profile) {
    if (Profile.Signature.IsEmpty() || Profile.Signature == AppliedSignature) return false;
    AppliedSignature = Profile.Signature;
    bFoundryComplete = Profile.bComplete;
    FoundryProblemCount = Profile.ProblemCount;
    UnresolvedSlotCount = 0;
    ClearParts();

    const FTVFoundrySlot* Body = Profile.FindSlot(TEXT("body"));
    USkeletalMesh* Visible = Profile.bComplete && Body && Body->AssetClass.Contains(TEXT("SkeletalMesh"), ESearchCase::IgnoreCase)
        ? LoadFoundryAsset<USkeletalMesh>(*Body) : nullptr;
    bVisibleCharacter = Visible != nullptr;
    if (!bVisibleCharacter) {
        SetSkeletalMesh(nullptr);
        SetVisibility(false);
        if (DriverMesh) DriverMesh->SetVisibility(true);
        ++UnresolvedSlotCount;
        return true;
    }

    EmptyOverrideMaterials();
    ClearMorphTargets();
    SetSkeletalMesh(Visible);
    SetVisibility(true);
    if (DriverMesh) DriverMesh->SetVisibility(false);

    UTVCharacterPalette* Palette = UTVCharacterPalette::Get();
    USkeleton* VisibleSkeleton = Visible->GetSkeleton();
    USkeletalMesh* DriverAsset = DriverMesh ? DriverMesh->GetSkeletalMeshAsset() : nullptr;
    USkeleton* DriverSkeleton = DriverAsset ? DriverAsset->GetSkeleton() : nullptr;
    const FString SkeletonKey = !Profile.Skeleton.IsEmpty() ? Profile.Skeleton : (VisibleSkeleton ? VisibleSkeleton->GetPathName() : FString());
    bRetargeted = false;
    if ((VisibleSkeleton && DriverSkeleton && VisibleSkeleton == DriverSkeleton) || Palette->SharesDriverSkeleton(SkeletonKey)) {
        SetComponentTickEnabled(false);
        SetAnimInstanceClass(nullptr);
        SetLeaderPoseComponent(DriverMesh);
    } else if (UClass* Retarget = Palette->RetargetAnimClass(SkeletonKey)) {
        SetComponentTickEnabled(true);
        SetLeaderPoseComponent(nullptr);
        SetAnimInstanceClass(Retarget);
        bRetargeted = true;
    } else {
        UE_LOG(LogTemp, Warning, TEXT("TV_EMBODIMENT no pose source for Foundry skeleton %s; keeping driver silhouette"), *SkeletonKey);
        SetSkeletalMesh(nullptr); SetVisibility(false);
        if (DriverMesh) DriverMesh->SetVisibility(true);
        bVisibleCharacter = false;
        ++UnresolvedSlotCount;
        return true;
    }

    USkeletalMeshComponent* FaceComponent = nullptr;
    for (const FTVFoundrySlot& Slot : Profile.Slots) {
        if (Slot.Slot == TEXT("body")) continue;
        if (Slot.AssetClass == TEXT("GroomAsset")) continue; // bind after the face exists
        if (!Slot.AssetClass.Contains(TEXT("SkeletalMesh"), ESearchCase::IgnoreCase)) {
            UE_LOG(LogTemp, Display, TEXT("TV_EMBODIMENT unresolved slot=%s package=%s reason=unsupported-class"), *Slot.Slot, *Slot.Package);
            ++UnresolvedSlotCount; continue;
        }
        USkeletalMesh* PartMesh = LoadFoundryAsset<USkeletalMesh>(Slot);
        if (!PartMesh) {
            UE_LOG(LogTemp, Display, TEXT("TV_EMBODIMENT unresolved slot=%s package=%s reason=missing-mesh"), *Slot.Slot, *Slot.Package);
            ++UnresolvedSlotCount; continue;
        }
        // MetaHuman faces can bind to a separate facial skeleton with additional bones. Such a
        // part needs its own inspected adapter; Leader Pose would leave those bones unmapped.
        const bool bSharedSkeleton = PartMesh->GetSkeleton() == VisibleSkeleton;
        UClass* PartAdapter = !bSharedSkeleton && PartMesh->GetSkeleton()
            ? Palette->RetargetAnimClass(PartMesh->GetSkeleton()->GetPathName()) : nullptr;
        if (!bSharedSkeleton && !PartAdapter) {
            UE_LOG(LogTemp, Display, TEXT("TV_EMBODIMENT unresolved slot=%s package=%s reason=missing-pose-adapter"), *Slot.Slot, *Slot.Package);
            ++UnresolvedSlotCount; continue;
        }
        USkeletalMeshComponent* Part = NewObject<USkeletalMeshComponent>(GetOwner());
        Part->SetupAttachment(this);
        Part->RegisterComponent();
        Part->SetSkeletalMesh(PartMesh);
        Part->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Part->VisibilityBasedAnimTickOption = EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones;
        Part->AddTickPrerequisiteComponent(this);
        if (bSharedSkeleton) {
            Part->SetLeaderPoseComponent(this);
            Part->SetComponentTickEnabled(false);
        } else {
            Part->SetAnimInstanceClass(PartAdapter);
            Part->SetComponentTickEnabled(true);
        }
        Parts.Add(Part);
        PartSlotKinds.Add(Slot.Slot);
        if (Slot.Slot == TEXT("head")) {
            FaceComponent = Part;
            if (UMaterialInterface* Skin = Palette->BodyMaterial(Slot.Package)) SetMaterial(0, Skin);
        }
        ++ResolvedPartCount;
    }

    for (const FTVFoundrySlot& Slot : Profile.Slots) {
        if (Slot.AssetClass != TEXT("GroomAsset")) continue;
        UGroomAsset* Asset = LoadFoundryAsset<UGroomAsset>(Slot);
        UGroomBindingAsset* Binding = FaceComponent ? Palette->GroomBinding(Asset, FaceComponent->GetSkeletalMeshAsset()) : nullptr;
        if (!Binding) {
            UE_LOG(LogTemp, Display, TEXT("TV_EMBODIMENT unresolved slot=%s package=%s reason=missing-groom-binding face=%s"),
                *Slot.Slot, *Slot.Package, *GetPathNameSafe(FaceComponent ? FaceComponent->GetSkeletalMeshAsset() : nullptr));
            ++UnresolvedSlotCount; continue;
        }
        UGroomComponent* Groom = NewObject<UGroomComponent>(GetOwner());
        Groom->SetupAttachment(FaceComponent);
        // Configure before binding/registering: SetEnableSimulation is ignored without this
        // override, leaving the expensive authored simulation active on each projected person.
        Groom->SimulationSettings.bOverrideSettings = true;
        Groom->SimulationSettings.SolverSettings.bEnableSimulation = false;
        Groom->SetGroomAsset(Asset, Binding, false);
        Groom->SetUseCards(true);
        Groom->SetForcedLOD(2);
        Groom->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Groom->RegisterComponent();
        Groom->AddTickPrerequisiteComponent(FaceComponent);
        Grooms.Add(Groom);
        ++ResolvedPartCount;
    }

    SetRelativeScale3D(TVPresentationScale(Profile.Build, Profile.Height));
    for (const auto& Morph : Profile.Morphs) SetMorphTarget(FName(*Morph.Key), FMath::Clamp(Morph.Value, 0.f, 1.f));
    ApplyTints(Profile);
    // After tinting, not before: ApplyTints creates the body's dynamic instances, and the atlas
    // index has to be written into the instance that ends up rendering.
    MatchBodyComplexionToFace(this, FaceComponent);
    return true;
}

FVector TVPresentationScale(float Build, float Height) {
    const float Stature = FMath::Clamp(FMath::IsFinite(Height) && Height > 0 ? Height : 1.f, .3f, 1.4f);
    const float Width = FMath::IsFinite(Build) && Build > 0 ? Build : Stature;
    const float Lateral = Stature * FMath::Clamp(Width / Stature, .9f, 1.08f);
    return FVector(Lateral, Lateral, Stature);
}

void UTVCharacterPresentation::ApplyTints(const FTVAppearanceProfile& Profile) {
    TintComponent(this, TEXT("M_TV_CharacterSkin"), Profile.Materials.Skin,
        Profile.Materials.GarmentAccent, Profile.Materials.Wear, Profile.Materials.Grooming);
    for (int32 Index = 0; Index < Parts.Num(); ++Index) {
        const FString& Slot = PartSlotKinds[Index];
        int64 Tint = Profile.Materials.GarmentAccent;
        const TCHAR* Material = TEXT("M_TV_CharacterProp");
        if (Slot == TEXT("head")) { Tint = Profile.Materials.Skin; Material = TEXT("M_TV_CharacterSkin"); }
        else if (Slot == TEXT("hair") || Slot == TEXT("facialHair")) { Tint = Profile.Materials.Hair; Material = TEXT("M_TV_CharacterHair"); }
        else if (Slot == TEXT("upperGarment") || Slot == TEXT("robe") || Slot == TEXT("armor")) { Tint = Profile.Materials.GarmentPrimary; Material = TEXT("M_TV_CharacterCloth"); }
        else if (Slot == TEXT("lowerGarment") || Slot == TEXT("footwear")) { Tint = Profile.Materials.GarmentSecondary; Material = TEXT("M_TV_CharacterCloth"); }
        TintComponent(Parts[Index], Material, Tint,
            Profile.Materials.GarmentAccent, Profile.Materials.Wear, Profile.Materials.Grooming);
    }
}

FString UTVCharacterPresentation::EmbodimentDiagnostics() const {
    return FString::Printf(
        TEXT("{\"signature\":\"%s\",\"foundryComplete\":%s,\"foundryProblems\":%d,\"visibleCharacter\":%s,\"retargeted\":%s,\"parts\":%d,\"unresolvedSlots\":%d}"),
        *AppliedSignature, bFoundryComplete ? TEXT("true") : TEXT("false"), FoundryProblemCount,
        bVisibleCharacter ? TEXT("true") : TEXT("false"), bRetargeted ? TEXT("true") : TEXT("false"),
        ResolvedPartCount, UnresolvedSlotCount);
}
