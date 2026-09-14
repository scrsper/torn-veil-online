#include "CoreMinimal.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "TVBridgeSubsystem.h"
#include "TVCharacter.h"
#include "TVCombatPresentationComponent.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
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
namespace TVCombatFlowProbe {
struct FPress{double At;FKey Key;bool Down;const TCHAR* Label;};
static const FKey Chains[6][3]={{EKeys::LeftMouseButton,EKeys::LeftMouseButton,EKeys::LeftMouseButton},{EKeys::LeftMouseButton,EKeys::LeftMouseButton,EKeys::RightMouseButton},{EKeys::RightMouseButton,EKeys::RightMouseButton,EKeys::LeftMouseButton},{EKeys::SpaceBar,EKeys::LeftMouseButton,EKeys::LeftMouseButton},{EKeys::LeftMouseButton,EKeys::SpaceBar,EKeys::LeftMouseButton},{EKeys::LeftMouseButton,EKeys::Invalid,EKeys::Invalid}};
static int Stage=-1,PressIndex=0;static FString PreviousCommand,PendingImage;static bool WalkStarted=false,WalkStopped=false,CameraTurned=false,CameraPitched=false;
static void SaveShot(int32 W,int32 H,const TArray<FColor>& Pixels){if(!PendingImage.IsEmpty())FFileHelper::CreateBitmap(*PendingImage,W,H,Pixels.GetData());}
static bool Running=false,Capture=false;static double Begin=0,LiveAt=-1,LastShot=-1;static int Index=0,Shot=0,View=-1;
static FString Directory;static TArray<TSharedPtr<FJsonValue>> Samples;static TArray<FKey> Release;
static TWeakObjectPtr<UWorld> World;static TWeakObjectPtr<ATVCharacter> Player;static TWeakObjectPtr<ACameraActor> Camera;
static TSharedPtr<FJsonObject> Parse(const FString& S){TSharedPtr<FJsonObject> J;FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(S),J);return J?J:MakeShared<FJsonObject>();}
static void Key(APlayerController* PC,const FKey& K,bool Down){const bool Axis=K==EKeys::MouseX||K==EKeys::MouseY;PC->InputKey(FInputKeyEventArgs(nullptr,IPlatformInputDeviceMapper::Get().GetDefaultInputDevice(),K,Axis?IE_Axis:Down?IE_Pressed:IE_Released,Axis?(K==EKeys::MouseX?45.f:12.f):Down?1.f:0.f,false,FPlatformTime::Cycles64()));}
static void Finish(const FString& Status){auto J=MakeShared<FJsonObject>();J->SetStringField(TEXT("status"),Status);J->SetStringField(TEXT("camera"),TEXT("fixed side verification camera; six ordinary-input sequences"));J->SetArrayField(TEXT("samples"),Samples);if(World.IsValid())J->SetObjectField(TEXT("diagnostics"),Parse(World->GetSubsystem<UTVBridgeSubsystem>()->RealtimeDiagnostics()));FString S;FJsonSerializer::Serialize(J,TJsonWriterFactory<>::Create(&S));FFileHelper::SaveStringToFile(S,*(Directory/TEXT("probe.json")));Running=false;FPlatformMisc::RequestExit(false);}
static bool Tick(float){
 if(!Running)return false;const double Now=FPlatformTime::Seconds();
 if(!World.IsValid())for(const auto& C:GEngine->GetWorldContexts())if(C.WorldType==EWorldType::Game){World=C.World();Player=Cast<ATVCharacter>(World->GetFirstPlayerController()?World->GetFirstPlayerController()->GetPawn():nullptr);}
 auto* B=World.IsValid()?World->GetSubsystem<UTVBridgeSubsystem>():nullptr;
 if(!B||!Player.IsValid()||!B->HasPrediction()){if(Now-Begin>45)Finish(TEXT("failed: no live prediction"));return Running;}
 auto* PC=World->GetFirstPlayerController();if(LiveAt<0){LiveAt=Now+2;Camera=World->SpawnActor<ACameraActor>();Camera->GetCameraComponent()->SetFieldOfView(55);PC->SetViewTarget(Camera.Get());}
 const double At=Now-LiveAt;if(At<0)return true;
 const int NewView=1;if(At>=28){Finish(TEXT("complete"));return false;}
 View=NewView;const int NewStage=FMath::FloorToInt(At/4);const double Local=At-NewStage*4;
 for(const FKey& K:Release)Key(PC,K,false);Release.Empty();
 if(Stage!=NewStage){Stage=NewStage;PressIndex=0;PreviousCommand.Empty();WalkStarted=WalkStopped=CameraTurned=CameraPitched=false;Key(PC,EKeys::W,false);Key(PC,EKeys::S,false);Key(PC,EKeys::F1,true);Key(PC,EKeys::F3,true);Release.Add(EKeys::F1);Release.Add(EKeys::F3);if(Stage==6)PC->SetViewTarget(Player.Get());}
 if(Local>=.15&&!WalkStarted){Key(PC,EKeys::S,true);WalkStarted=true;}
 if(Local>=.45&&!WalkStopped){Key(PC,EKeys::S,false);WalkStopped=true;}
 auto Current=Parse(Player->PresentationDiagnostics());
 const FString Command=Current->GetStringField(TEXT("liveCommandId"));
 const int ChainStage=FMath::Min(Stage,5);
 const bool NextReady=PressIndex<3&&(PressIndex==0?Local>=.7:Command!=PreviousCommand&&Current->GetBoolField(TEXT("choreographyActive"))&&Player->CombatPresentation->LiveActionAge()>=Player->CombatPresentation->TransitionAge(Chains[ChainStage][PressIndex]==EKeys::SpaceBar?TEXT("backstep"):TEXT("attack"))-.16);
 if(PressIndex<3&&Chains[ChainStage][PressIndex]!=EKeys::Invalid&&NextReady){const auto K=Chains[ChainStage][PressIndex];Key(PC,K,true);Release.Add(K);PreviousCommand=Command;auto E=MakeShared<FJsonObject>();E->SetStringField(TEXT("event"),TEXT("input"));E->SetNumberField(TEXT("at"),At);E->SetNumberField(TEXT("stage"),Stage);E->SetNumberField(TEXT("index"),PressIndex++);E->SetStringField(TEXT("key"),K.ToString());Samples.Add(MakeShared<FJsonValueObject>(E));}
 if(Stage==6&&Local>=.85&&!CameraTurned){Key(PC,EKeys::MouseX,true);CameraTurned=true;}
 if(Stage==6&&Local>=1.05&&!CameraPitched){Key(PC,EKeys::MouseY,true);CameraPitched=true;}
 if(Stage==5){if(Local>=.5&&Local<.7)Key(PC,EKeys::W,true);if(Local>1.05&&Local<1.4)Key(PC,EKeys::W,true);if(Local>1.6)Key(PC,EKeys::W,false);}
 const FVector Forward=Player->GetActorForwardVector(),Right=Player->GetActorRightVector(),Center=Player->GetActorLocation()-FVector(0,0,10);
 // A slight front oblique avoids putting the passive target directly over the fighter.
 const FVector Offset=(View==0?Forward*590+Right*260:View==1?Right*650:-Forward*620+Right*140)+FVector(0,0,120);
 if(Stage<6){Camera->SetActorLocation(Center+Offset);Camera->SetActorRotation((-Offset).Rotation());}
 auto F=MakeShared<FJsonObject>();F->SetStringField(TEXT("event"),TEXT("frame"));F->SetNumberField(TEXT("at"),At);F->SetNumberField(TEXT("view"),View);F->SetNumberField(TEXT("stage"),Stage);
 F->SetNumberField(TEXT("wallTime"),Now);F->SetNumberField(TEXT("inputCallbackAt"),B->CombatInputCallbackAt);
 F->SetObjectField(TEXT("player"),Parse(Player->PresentationDiagnostics()));F->SetStringField(TEXT("feedback"),B->LastResult);F->SetStringField(TEXT("practice"),B->PracticeStatus);F->SetStringField(TEXT("resources"),B->PracticeLast);
 auto Bones=MakeShared<FJsonObject>();for(const TCHAR* Name:{TEXT("middle_01_l"),TEXT("middle_01_r"),TEXT("foot_l"),TEXT("foot_r"),TEXT("head"),TEXT("pelvis"),TEXT("root"),TEXT("spine_01"),TEXT("spine_03"),TEXT("upperarm_l"),TEXT("upperarm_r"),TEXT("lowerarm_l"),TEXT("lowerarm_r"),TEXT("thigh_l"),TEXT("thigh_r"),TEXT("calf_l"),TEXT("calf_r")}){const auto T=Player->GetMesh()->GetSocketTransform(Name,RTS_Component);const auto P=T.GetLocation();const auto R=T.GetRotation();TArray<TSharedPtr<FJsonValue>> Values;for(double V:{P.X,P.Y,P.Z,R.X,R.Y,R.Z,R.W})Values.Add(MakeShared<FJsonValueNumber>(V));Bones->SetArrayField(Name,Values);}F->SetObjectField(TEXT("bones"),Bones);
 TArray<TSharedPtr<FJsonValue>> Others;for(TActorIterator<ATVCharacter> It(World.Get());It;++It)if(!It->IsPlayerControlled())Others.Add(MakeShared<FJsonValueObject>(Parse(It->PresentationDiagnostics())));F->SetArrayField(TEXT("others"),Others);Samples.Add(MakeShared<FJsonValueObject>(F));
 if(Capture&&At-LastShot>=1./30){const FString Name=FString::Printf(TEXT("frame-%04d.bmp"),Shot++);PendingImage=Directory/Name;FScreenshotRequest::RequestScreenshot(Directory/Name,true,false);F->SetStringField(TEXT("screenshot"),Name);LastShot=At;}
 return true;
}
static void Start(const TArray<FString>&){if(Running)return;Running=true;Begin=FPlatformTime::Seconds();LiveAt=LastShot=-1;Index=Shot=0;View=-1;Samples.Empty();Release.Empty();Stage=-1;UGameViewportClient::OnScreenshotCaptured().AddStatic(SaveShot);World.Reset();Player.Reset();Camera.Reset();Directory=FPlatformMisc::GetEnvironmentVariable(TEXT("TV_REPAIR_OUTPUT"));if(Directory.IsEmpty())Directory=FPaths::ProjectDir()/TEXT("../../.debug/combat-refinement");IFileManager::Get().MakeDirectory(*Directory,true);Capture=FPlatformMisc::GetEnvironmentVariable(TEXT("TV_REPAIR_CAPTURE"))==TEXT("1");FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(Tick));}
static FAutoConsoleCommand Command(TEXT("TV.CombatFlowProbe"),TEXT("Continuous flow ordinary-input capture and pose diagnostics; then exit"),FConsoleCommandWithArgsDelegate::CreateStatic(Start));
}
#endif
