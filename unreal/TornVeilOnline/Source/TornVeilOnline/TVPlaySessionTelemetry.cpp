// Read-only telemetry for a human packaged play session. Never sends input or changes camera/world.
#include "CoreMinimal.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "TVBridgeSubsystem.h"
#include "TVControlSettings.h"
#include "Engine/Engine.h"
#include "GameFramework/PlayerController.h"
#include "Containers/Ticker.h"
#include "HAL/IConsoleManager.h"
#include "HAL/FileManager.h"
#include "Misc/CoreDelegates.h"
#include "Misc/FileHelper.h"
#include "Serialization/JsonSerializer.h"
namespace TVPlaySessionTelemetry {
static bool Running=false;static double Started=0,Last=0,LastWrite=0,Duration=3000,ConnectedSeconds=0,ModalSeconds=0;
static FString Directory;static TArray<double> Frames;static TMap<FString,int32> Devices;static int32 Hitches50=0,Hitches100=0,Hitches250=0;
static void Write(bool Final){
 auto J=MakeShared<FJsonObject>();J->SetStringField(TEXT("kind"),TEXT("Human play telemetry; actions and controller usability require tester confirmation"));
 J->SetBoolField(TEXT("finished"),Final);J->SetBoolField(TEXT("complete"),Final&&FPlatformTime::Seconds()-Started>=Duration);J->SetNumberField(TEXT("requestedSeconds"),Duration);J->SetNumberField(TEXT("elapsedSeconds"),FPlatformTime::Seconds()-Started);
 J->SetNumberField(TEXT("connectedSeconds"),ConnectedSeconds);J->SetNumberField(TEXT("modalSeconds"),ModalSeconds);J->SetNumberField(TEXT("frames"),Frames.Num());
 TArray<double> Sorted=Frames;Sorted.Sort();double Sum=0;for(double Dt:Sorted)Sum+=Dt;
 J->SetNumberField(TEXT("averageFPS"),Sum>0?Sorted.Num()/Sum:0);
 for(const auto& P:TArray<TPair<const TCHAR*,double>>{{TEXT("p50Ms"),.5},{TEXT("p95Ms"),.95},{TEXT("p99Ms"),.99}})J->SetNumberField(P.Key,Sorted.IsEmpty()?0:1000*Sorted[FMath::Clamp(FMath::RoundToInt((Sorted.Num()-1)*P.Value),0,Sorted.Num()-1)]);
 J->SetNumberField(TEXT("framesOver50ms"),Hitches50);J->SetNumberField(TEXT("framesOver100ms"),Hitches100);J->SetNumberField(TEXT("framesOver250ms"),Hitches250);
 auto D=MakeShared<FJsonObject>();for(const auto& Pair:Devices)D->SetNumberField(Pair.Key,Pair.Value);J->SetObjectField(TEXT("inputDeviceFrames"),D);
 FString Text;FJsonSerializer::Serialize(J,TJsonWriterFactory<>::Create(&Text));FFileHelper::SaveStringToFile(Text,*(Directory/TEXT("play-session.json")));
}
static void Stop(){if(!Running)return;Write(true);Running=false;}
static bool Tick(float){
 if(!Running)return false;const double Now=FPlatformTime::Seconds(),Dt=Now-Last;Last=Now;Frames.Add(Dt);
 Hitches50+=Dt>.05;Hitches100+=Dt>.1;Hitches250+=Dt>.25;
 for(const auto& C:GEngine->GetWorldContexts())if(C.WorldType==EWorldType::Game){
  auto* W=C.World();auto* B=W?W->GetSubsystem<UTVBridgeSubsystem>():nullptr;auto* PC=W?W->GetFirstPlayerController():nullptr;
  if(B&&B->IsLive()&&B->SinceSnapshot<2)ConnectedSeconds+=Dt;
  if(B&&B->HasModalScreen())ModalSeconds+=Dt;
  Devices.FindOrAdd(UTVControlSettings::DeviceFamily(PC?PC->GetLocalPlayer():nullptr))++;break;
 }
 if(Now-Started>=Duration){Stop();return false;}if(Now-LastWrite>=30){Write(false);LastWrite=Now;}return true;
}
static void Start(const TArray<FString>& Args){
 if(Running)return;Directory=FPlatformMisc::GetEnvironmentVariable(TEXT("TV_PLAY_SESSION_OUTPUT"));if(Directory.IsEmpty())return;
 if(IFileManager::Get().FileExists(*(Directory/TEXT("play-session.json")))){UE_LOG(LogTemp,Warning,TEXT("Play-session evidence already exists; choose a new directory"));return;}
 IFileManager::Get().MakeDirectory(*Directory,true);Duration=Args.Num()?FMath::Clamp(FCString::Atod(*Args[0]),60.,3600.):3000.;
 Frames.Empty();Devices.Empty();ConnectedSeconds=ModalSeconds=0;Hitches50=Hitches100=Hitches250=0;Started=Last=LastWrite=FPlatformTime::Seconds();Running=true;
 Write(false);FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(Tick));FCoreDelegates::OnPreExit.AddStatic(Stop);
}
static FAutoConsoleCommand StartCommand(TEXT("TV.PlaySession.Start"),TEXT("Observe human play without injecting input or moving the camera"),FConsoleCommandWithArgsDelegate::CreateStatic(Start));
static FAutoConsoleCommand StopCommand(TEXT("TV.PlaySession.Stop"),TEXT("Finish the human play telemetry report without leaving the world"),FConsoleCommandDelegate::CreateStatic(Stop));
}
#endif
