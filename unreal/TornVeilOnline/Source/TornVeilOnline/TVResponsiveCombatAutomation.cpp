#include "TVLiveCombat.h"
#include "TVInteractionSpec.generated.h"
#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "Animation/AnimSequence.h"
#include "GameFramework/InputSettings.h"
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVResponsiveCombatTransitions,"TornVeil.Realtime.Repair.Transitions",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FTVResponsiveCombatTransitions::RunTest(const FString&) {
 auto Step=FTVLiveCombat::Predict(TEXT("sidestep"),0,1,TEXT("step"));
 auto Punch=FTVLiveCombat::Predict(TEXT("attack"),0,1,TEXT("punch"));
 TestNearlyEqual(TEXT("step chains at end of displacement"),Step.TransitionAge(TEXT("attack")),TVInteractionSpec::defenseSeconds,.00001);
 TestTrue(TEXT("step follow-up need not wait until idle"),Step.TransitionAge(TEXT("sidestep"))<Step.CompleteAt);
 TestNearlyEqual(TEXT("punch chain retains active commitment"),Punch.TransitionAge(TEXT("attack")),.48,.00001);
 TestNearlyEqual(TEXT("attack evade window is explicit"),Punch.TransitionAge(TEXT("sidestep")),.51,.00001);
 Punch.Outcome=TEXT("interrupted");TestNearlyEqual(TEXT("interrupted attack cannot chain early"),Punch.TransitionAge(TEXT("attack")),Punch.CompleteAt,.00001);
 for(const TCHAR* Kind:{TEXT("attack"),TEXT("sidestep"),TEXT("backstep"),TEXT("duck")}){
  auto A=FTVLiveCombat::Predict(Kind,0,1,TEXT("test"));const auto P=A.Plan(0);
  TestTrue(TEXT("live full-body clip exists"),LoadObject<UAnimSequence>(nullptr,*P.Motion.AssetPath)!=nullptr);
  TestTrue(TEXT("live clip has visible motion weight"),P.Weight(.15)>0.9);
  TestNearlyEqual(TEXT("clip follows canonical time"),double(P.SampleTime(.15)),.15,.00001);
 }
 TArray<FInputActionKeyMapping> Keys;GetDefault<UInputSettings>()->GetActionMappingByName(TEXT("HeavyAttack"),Keys);
 TestTrue(TEXT("heavy attack is remappable and has mouse/controller mappings"),Keys.Num()>=2);
 return true;
}
#endif
