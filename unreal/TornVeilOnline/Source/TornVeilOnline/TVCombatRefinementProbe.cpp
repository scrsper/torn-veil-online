#include "CoreMinimal.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "TVBridgeSubsystem.h"
#include "TVCharacter.h"
#include "TVCombatPresentationComponent.h"
#include "Engine/Engine.h"
#include "EngineUtils.h"
#include "UnrealClient.h"
#include "Containers/Ticker.h"
#include "GameFramework/PlayerController.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "GenericPlatform/GenericPlatformInputDeviceMapper.h"
#include "InputKeyEventArgs.h"
#include "InputCoreTypes.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
namespace TVCombatRefinementProbe {
struct FPress{double At;FKey Key;bool Down;const TCHAR* Label;};
static const TArray<FPress> Script={
 {.1,EKeys::F1,true,TEXT("passive")},{.2,EKeys::F3,true,TEXT("reset")},
 {.5,EKeys::S,true,TEXT("backward_walk")},{.85,EKeys::S,false,TEXT("stop_backward")},
 {1.,EKeys::A,true,TEXT("strafe_left")},{1.25,EKeys::SpaceBar,true,TEXT("held_left_step")},{1.3,EKeys::A,false,TEXT("release_left")},
 {1.43,EKeys::LeftMouseButton,true,TEXT("step_light_buffer")},{1.76,EKeys::LeftMouseButton,true,TEXT("light_light_buffer")},{2.25,EKeys::RightMouseButton,true,TEXT("cross_front_kick_buffer")},
 {3.6,EKeys::F3,true,TEXT("reset_kicks")},{4.1,EKeys::S,true,TEXT("make_space")},{4.4,EKeys::S,false,TEXT("stop")},
 {5.,EKeys::RightMouseButton,true,TEXT("front_kick")},{5.45,EKeys::RightMouseButton,true,TEXT("round_kick_buffer")},{6.15,EKeys::LeftMouseButton,true,TEXT("round_light_buffer")},{6.65,EKeys::SpaceBar,true,TEXT("punch_backstep_buffer")},
 {7.5,EKeys::LeftControl,true,TEXT("hold_crouch")},{8.2,EKeys::D,true,TEXT("crouch_strafe")},{8.8,EKeys::D,false,TEXT("crouch_stop")},{9.8,EKeys::LeftControl,false,TEXT("release_crouch")},
 {10.6,EKeys::LeftMouseButton,true,TEXT("jab")},{10.9,EKeys::LeftControl,true,TEXT("queue_crouch")},{10.95,EKeys::LeftControl,false,TEXT("release_queued_crouch")},
 {12.,EKeys::W,true,TEXT("walk")},{12.5,EKeys::LeftShift,true,TEXT("sprint")},{13.5,EKeys::W,false,TEXT("stop_walk")},{13.5,EKeys::LeftShift,false,TEXT("stop_sprint")},
 {14.,EKeys::F2,true,TEXT("incoming_mode")},{14.15,EKeys::F3,true,TEXT("reset_preserves_incoming")},
 {18.,EKeys::F1,true,TEXT("passive")},{18.1,EKeys::F3,true,TEXT("reset_turn")},
 {19.,EKeys::LeftMouseButton,true,TEXT("committed_punch")},{19.35,EKeys::MouseX,true,TEXT("camera_during_commitment")},
 {20.2,EKeys::MouseX,true,TEXT("stationary_camera_turn")},{20.5,EKeys::D,true,TEXT("strafe_new_facing")},{20.8,EKeys::SpaceBar,true,TEXT("frozen_dodge")},{20.9,EKeys::D,false,TEXT("stop_strafe")},
 {21.4,EKeys::F4,true,TEXT("normal_physiology")},{22.4,EKeys::F4,true,TEXT("practice_recovery")}
};
static bool Running=false,Capture=false;static double Begin=0,LiveAt=-1,LastShot=-1;static int Index=0,Shot=0,View=-1;
static FString Directory;static TArray<TSharedPtr<FJsonValue>> Samples;static TArray<FKey> Release;
static TWeakObjectPtr<UWorld> World;static TWeakObjectPtr<ATVCharacter> Player;static TWeakObjectPtr<ACameraActor> Camera;
static TSharedPtr<FJsonObject> Parse(const FString& S){TSharedPtr<FJsonObject> J;FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(S),J);return J?J:MakeShared<FJsonObject>();}
static void Key(APlayerController* PC,const FKey& K,bool Down){PC->InputKey(FInputKeyEventArgs(nullptr,IPlatformInputDeviceMapper::Get().GetDefaultInputDevice(),K,K==EKeys::MouseX?IE_Axis:Down?IE_Pressed:IE_Released,K==EKeys::MouseX?45.f:Down?1.f:0.f,false,FPlatformTime::Cycles64()));}
static void Finish(const FString& Status){auto J=MakeShared<FJsonObject>();J->SetStringField(TEXT("status"),Status);J->SetStringField(TEXT("camera"),TEXT("external front/side/rear verification camera; ordinary controller input"));J->SetArrayField(TEXT("samples"),Samples);if(World.IsValid())J->SetObjectField(TEXT("diagnostics"),Parse(World->GetSubsystem<UTVBridgeSubsystem>()->RealtimeDiagnostics()));FString S;FJsonSerializer::Serialize(J,TJsonWriterFactory<>::Create(&S));FFileHelper::SaveStringToFile(S,*(Directory/TEXT("probe.json")));Running=false;FPlatformMisc::RequestExit(false);}
static bool Tick(float){
 if(!Running)return false;const double Now=FPlatformTime::Seconds();
 if(!World.IsValid())for(const auto& C:GEngine->GetWorldContexts())if(C.WorldType==EWorldType::Game){World=C.World();Player=Cast<ATVCharacter>(World->GetFirstPlayerController()?World->GetFirstPlayerController()->GetPawn():nullptr);}
 auto* B=World.IsValid()?World->GetSubsystem<UTVBridgeSubsystem>():nullptr;
 if(!B||!Player.IsValid()||!B->HasPrediction()){if(Now-Begin>45)Finish(TEXT("failed: no live prediction"));return Running;}
 auto* PC=World->GetFirstPlayerController();if(LiveAt<0){LiveAt=Now+2;Camera=World->SpawnActor<ACameraActor>();Camera->GetCameraComponent()->SetFieldOfView(55);PC->SetViewTarget(Camera.Get());}
 const double At=Now-LiveAt;if(At<0)return true;
 const int NewView=FMath::FloorToInt(At/24);if(NewView>=(Capture?3:1)){Finish(TEXT("complete"));return false;}
 if(NewView!=View){View=NewView;Index=0;}
 const double Local=At-View*24;
 for(const FKey& K:Release)Key(PC,K,false);Release.Empty();
 while(Index<Script.Num()&&Local>=Script[Index].At){const auto& P=Script[Index++];Key(PC,P.Key,P.Down);auto E=MakeShared<FJsonObject>();E->SetStringField(TEXT("event"),P.Label);E->SetNumberField(TEXT("at"),At);E->SetNumberField(TEXT("view"),View);Samples.Add(MakeShared<FJsonValueObject>(E));
  if(P.Down&&P.Key!=EKeys::W&&P.Key!=EKeys::S&&P.Key!=EKeys::A&&P.Key!=EKeys::D&&P.Key!=EKeys::LeftShift&&P.Key!=EKeys::LeftControl&&P.Key!=EKeys::MouseX)Release.Add(P.Key);
 }
 const FVector Forward=Player->GetActorForwardVector(),Right=Player->GetActorRightVector(),Center=Player->GetActorLocation()-FVector(0,0,10);
 // A slight front oblique avoids putting the passive target directly over the fighter.
 const FVector Offset=(View==0?Forward*590+Right*260:View==1?Right*650:-Forward*620+Right*140)+FVector(0,0,120);
 Camera->SetActorLocation(Center+Offset);Camera->SetActorRotation((-Offset).Rotation());
 auto F=MakeShared<FJsonObject>();F->SetStringField(TEXT("event"),TEXT("frame"));F->SetNumberField(TEXT("at"),At);F->SetNumberField(TEXT("view"),View);
 F->SetNumberField(TEXT("wallTime"),Now);F->SetNumberField(TEXT("inputCallbackAt"),B->CombatInputCallbackAt);
 F->SetObjectField(TEXT("player"),Parse(Player->PresentationDiagnostics()));F->SetStringField(TEXT("feedback"),B->LastResult);F->SetStringField(TEXT("practice"),B->PracticeStatus);F->SetStringField(TEXT("resources"),B->PracticeLast);
 auto Bones=MakeShared<FJsonObject>();for(const TCHAR* Name:{TEXT("middle_01_l"),TEXT("middle_01_r"),TEXT("foot_l"),TEXT("foot_r"),TEXT("head"),TEXT("pelvis")}){const auto T=Player->GetMesh()->GetSocketTransform(Name,RTS_Component);const auto P=T.GetLocation(),R=T.Rotator().Euler();TArray<TSharedPtr<FJsonValue>> Values;for(double V:{P.X,P.Y,P.Z,R.X,R.Y,R.Z})Values.Add(MakeShared<FJsonValueNumber>(V));Bones->SetArrayField(Name,Values);}F->SetObjectField(TEXT("bones"),Bones);
 TArray<TSharedPtr<FJsonValue>> Others;for(TActorIterator<ATVCharacter> It(World.Get());It;++It)if(!It->IsPlayerControlled())Others.Add(MakeShared<FJsonValueObject>(Parse(It->PresentationDiagnostics())));F->SetArrayField(TEXT("others"),Others);Samples.Add(MakeShared<FJsonValueObject>(F));
 if(Capture&&At-LastShot>=.1){const FString Name=FString::Printf(TEXT("frame-%04d.png"),Shot++);FScreenshotRequest::RequestScreenshot(Directory/Name,true,false);F->SetStringField(TEXT("screenshot"),Name);LastShot=At;}
 return true;
}
static void Start(const TArray<FString>&){if(Running)return;Running=true;Begin=FPlatformTime::Seconds();LiveAt=LastShot=-1;Index=Shot=0;View=-1;Samples.Empty();Release.Empty();World.Reset();Player.Reset();Camera.Reset();Directory=FPlatformMisc::GetEnvironmentVariable(TEXT("TV_REPAIR_OUTPUT"));if(Directory.IsEmpty())Directory=FPaths::ProjectDir()/TEXT("../../.debug/combat-refinement");IFileManager::Get().MakeDirectory(*Directory,true);Capture=FPlatformMisc::GetEnvironmentVariable(TEXT("TV_REPAIR_CAPTURE"))==TEXT("1");FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(Tick));}
static FAutoConsoleCommand Command(TEXT("TV.CombatRefinementProbe"),TEXT("Ordinary inputs, one camera, front/side/rear capture; then exit"),FConsoleCommandWithArgsDelegate::CreateStatic(Start));
}
#endif
