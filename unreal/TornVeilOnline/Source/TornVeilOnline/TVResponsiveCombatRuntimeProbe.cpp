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
#include "GameFramework/SpringArmComponent.h"
#include "GenericPlatform/GenericPlatformInputDeviceMapper.h"
#include "InputKeyEventArgs.h"
#include "InputCoreTypes.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/CommandLine.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
namespace TVCombatRepairProbe {
struct FPress {double At;FKey Key;bool Down;const TCHAR* Label;};
static const TArray<FPress> Script={
 {.20,EKeys::F3,true,TEXT("reset")},{.35,EKeys::S,true,TEXT("walk_away")},{.68,EKeys::S,false,TEXT("stop_walk")},
 {.85,EKeys::LeftMouseButton,true,TEXT("free_punch")},{1.50,EKeys::Tab,true,TEXT("select_distant")},{1.70,EKeys::LeftMouseButton,true,TEXT("distant_selected_punch")},
 {2.70,EKeys::F3,true,TEXT("reset_sequence")},{3.20,EKeys::D,true,TEXT("right_held")},{3.22,EKeys::SpaceBar,true,TEXT("right_step_1")},
 {3.39,EKeys::SpaceBar,true,TEXT("right_step_2_buffer")},{3.47,EKeys::D,false,TEXT("release_right")},{3.53,EKeys::A,true,TEXT("left_held")},
 {3.61,EKeys::SpaceBar,true,TEXT("left_step_buffer")},{3.70,EKeys::A,false,TEXT("release_left")},{3.86,EKeys::LeftMouseButton,true,TEXT("step_to_punch")},
 {4.31,EKeys::LeftMouseButton,true,TEXT("punch_to_punch")},{4.83,EKeys::SpaceBar,true,TEXT("attack_to_backstep")},
 {6.0,EKeys::F3,true,TEXT("reset_combo")},{6.50,EKeys::LeftMouseButton,true,TEXT("light_1")},{6.80,EKeys::LeftMouseButton,true,TEXT("light_2_buffer")},
 {7.30,EKeys::RightMouseButton,true,TEXT("heavy_buffer")},{9.20,EKeys::F2,true,TEXT("repeat_opponent")},
 {12.50,EKeys::F1,true,TEXT("passive_opponent")},{12.80,EKeys::F3,true,TEXT("recover")},{13.30,EKeys::RightMouseButton,true,TEXT("kick_target_reaction")},
 {14.50,EKeys::W,true,TEXT("walk")},{15.30,EKeys::LeftShift,true,TEXT("sprint")},{16.30,EKeys::W,false,TEXT("stop_walk")},{16.30,EKeys::LeftShift,false,TEXT("stop_sprint")},
 {17.0,EKeys::F3,true,TEXT("reset_duck")},{17.5,EKeys::LeftControl,true,TEXT("duck_performance")}
};
static const TArray<FPress> MartialScript={
 {.2,EKeys::F3,true,TEXT("untrained_reset")},{.35,EKeys::S,true,TEXT("separate")},{.68,EKeys::S,false,TEXT("stop")},
 {1.,EKeys::LeftMouseButton,true,TEXT("untrained_light_1")},{1.34,EKeys::LeftMouseButton,true,TEXT("untrained_light_2_buffer")},{1.85,EKeys::RightMouseButton,true,TEXT("untrained_heavy_buffer")},
 {3.3,EKeys::F4,true,TEXT("partial_profile")},{3.6,EKeys::S,true,TEXT("separate")},{3.93,EKeys::S,false,TEXT("stop")},
 {4.3,EKeys::LeftMouseButton,true,TEXT("partial_light_1")},{4.64,EKeys::LeftMouseButton,true,TEXT("partial_light_2_buffer")},{5.15,EKeys::RightMouseButton,true,TEXT("partial_heavy_buffer")},
 {6.6,EKeys::F4,true,TEXT("trained_profile")},{6.9,EKeys::S,true,TEXT("separate")},{7.23,EKeys::S,false,TEXT("stop")},
 {7.6,EKeys::LeftMouseButton,true,TEXT("trained_light_1")},{7.94,EKeys::LeftMouseButton,true,TEXT("trained_light_2_buffer")},{8.45,EKeys::RightMouseButton,true,TEXT("trained_heavy_buffer")},
 {10.,EKeys::F3,true,TEXT("trained_contact_reset")},{10.5,EKeys::LeftMouseButton,true,TEXT("trained_contact")},
 {12.,EKeys::LeftControl,true,TEXT("trained_duck")},{13.,EKeys::SpaceBar,true,TEXT("trained_backstep")}
};
static bool Martial=false;
static bool Running=false,Capture=false,Reacted=false;static double Begin=0,LiveAt=-1,LastShot=-1,PrepAt=-1;static int Index=0,Shot=0;
static FString Directory;static TArray<TSharedPtr<FJsonValue>> Samples;static TArray<FKey> Release;
static TWeakObjectPtr<UWorld> World;static TWeakObjectPtr<ATVCharacter> Player;
static TSharedPtr<FJsonObject> Parse(const FString& S){TSharedPtr<FJsonObject> J;FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(S),J);return J?J:MakeShared<FJsonObject>();}
static void Key(APlayerController* PC,const FKey& K,bool Down){PC->InputKey(FInputKeyEventArgs(nullptr,IPlatformInputDeviceMapper::Get().GetDefaultInputDevice(),K,Down?IE_Pressed:IE_Released,Down?1.f:0.f,false,FPlatformTime::Cycles64()));}
static void Event(const TCHAR* Label,double At){auto J=MakeShared<FJsonObject>();J->SetStringField(TEXT("event"),Label);J->SetNumberField(TEXT("at"),At);Samples.Add(MakeShared<FJsonValueObject>(J));}
static void Finish(const FString& Status){auto J=MakeShared<FJsonObject>();J->SetStringField(TEXT("status"),Status);J->SetArrayField(TEXT("samples"),Samples);if(World.IsValid())if(auto* B=World->GetSubsystem<UTVBridgeSubsystem>())J->SetObjectField(TEXT("diagnostics"),Parse(B->RealtimeDiagnostics()));FString S;FJsonSerializer::Serialize(J,TJsonWriterFactory<>::Create(&S));FFileHelper::SaveStringToFile(S,*(Directory/TEXT("probe.json")));Running=false;FPlatformMisc::RequestExit(false);}
static bool Tick(float){
 if(!Running)return false;const double Now=FPlatformTime::Seconds();
 if(!World.IsValid())for(const auto& C:GEngine->GetWorldContexts())if(C.WorldType==EWorldType::Game){World=C.World();Player=Cast<ATVCharacter>(World->GetFirstPlayerController()?World->GetFirstPlayerController()->GetPawn():nullptr);}
 auto* B=World.IsValid()?World->GetSubsystem<UTVBridgeSubsystem>():nullptr;
 if(!B||!Player.IsValid()||!B->HasPrediction()){if(Now-Begin>45)Finish(TEXT("failed: no live prediction"));return Running;}
 auto* PC=World->GetFirstPlayerController();if(LiveAt<0){if(Martial)B->SetPractice(TEXT("untrained"));LiveAt=Now+2;Player->CameraBoom->TargetArmLength=480;Event(TEXT("live"),Now-Begin);}
 const double At=Now-LiveAt;if(At<0)return true;
 for(const FKey& K:Release)Key(PC,K,false);Release.Empty();
 const auto& ActiveScript=Martial?MartialScript:Script;
 while(Index<ActiveScript.Num()&&At>=ActiveScript[Index].At){const auto& P=ActiveScript[Index++];Key(PC,P.Key,P.Down);Event(P.Label,At);
  if(P.Down&&P.Key!=EKeys::W&&P.Key!=EKeys::S&&P.Key!=EKeys::A&&P.Key!=EKeys::D&&P.Key!=EKeys::LeftShift)Release.Add(P.Key);
 }
 if(!Martial&&At>9.2&&At<12&&!Reacted){
  for(TActorIterator<ATVCharacter> It(World.Get());It;++It)if(!It->IsPlayerControlled()){
   auto J=Parse(It->PresentationDiagnostics());FString Phase;if(J->TryGetStringField(TEXT("livePhase"),Phase)&&Phase==TEXT("preparation")){if(PrepAt<0){PrepAt=At;Event(TEXT("opponent_preparation"),At);}break;}
  }
  if(PrepAt>=0&&At-PrepAt>=.06){Key(PC,EKeys::LeftControl,true);Release.Add(EKeys::LeftControl);Reacted=true;Event(TEXT("duck_after_observed_preparation"),At);}
 }
 auto Frame=MakeShared<FJsonObject>();Frame->SetStringField(TEXT("event"),TEXT("frame"));Frame->SetNumberField(TEXT("at"),At);
 Frame->SetObjectField(TEXT("player"),Parse(Player->PresentationDiagnostics()));Frame->SetStringField(TEXT("feedback"),B->LastResult);Frame->SetStringField(TEXT("practice"),B->PracticeStatus);
 auto Selected=B->Selected();Frame->SetStringField(TEXT("selection"),Selected?Selected->BodyId:TEXT(""));
 if(Selected)Frame->SetNumberField(TEXT("selectedDistanceCm"),FVector::Dist(Player->GetActorLocation(),Selected->GetActorLocation()));
 TArray<TSharedPtr<FJsonValue>> Others;for(TActorIterator<ATVCharacter> It(World.Get());It;++It)if(!It->IsPlayerControlled())Others.Add(MakeShared<FJsonValueObject>(Parse(It->PresentationDiagnostics())));Frame->SetArrayField(TEXT("others"),Others);Samples.Add(MakeShared<FJsonValueObject>(Frame));
 if(Capture&&At-LastShot>=.05){const FString Name=FString::Printf(TEXT("frame-%04d.png"),Shot++);FScreenshotRequest::RequestScreenshot(Directory/Name,true,false);Frame->SetStringField(TEXT("screenshot"),Name);LastShot=At;}
 if(At>=(Martial?14.5:19.5)){Finish(TEXT("complete"));return false;}return true;
}
static void Start(const TArray<FString>&){if(Running)return;Running=true;Martial=FPlatformMisc::GetEnvironmentVariable(TEXT("TV_MARTIAL_PROBE"))==TEXT("1");Begin=FPlatformTime::Seconds();LiveAt=-1;Index=Shot=0;PrepAt=LastShot=-1;Reacted=false;Samples.Empty();Release.Empty();World.Reset();Player.Reset();Directory=FPlatformMisc::GetEnvironmentVariable(TEXT("TV_REPAIR_OUTPUT"));if(Directory.IsEmpty())Directory=FPaths::ProjectDir()/TEXT("../../.debug/combat-repair-live");IFileManager::Get().MakeDirectory(*Directory,true);Capture=FPlatformMisc::GetEnvironmentVariable(TEXT("TV_REPAIR_CAPTURE"))==TEXT("1");FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(Tick));}
static FAutoConsoleCommand Command(TEXT("TV.CombatRepairProbe"),TEXT("Bounded ordinary-key combat repair sequence, then exit"),FConsoleCommandWithArgsDelegate::CreateStatic(Start));
}
#endif
