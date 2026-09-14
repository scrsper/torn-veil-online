#include "TVLiveCombat.h"
#include "TVInteractionSpec.generated.h"
#include "TVCombatRepertoire.generated.h"
#include "TVCombatPoseFlow.h"
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
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVCombatRefinementParity,"TornVeil.Realtime.Refinement.FacingPostureRepertoire",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FTVCombatRefinementParity::RunTest(const FString&){
 auto Floor=[](int,int)->TOptional<FTVPredictionColumn>{return FTVPredictionColumn{1,true,{0}};};
 FTVMovementState S{FVector(10,1,10),0,3,true};
 for(const auto V:{FVector2D(0,-1),FVector2D(0,1),FVector2D(1,0),FVector2D(-1,0),FVector2D(1,1)}){
  const auto N=FTVInteractionPrediction::Step(S,{V.X,V.Y,false,0.},1./60,Floor);
  TestNearlyEqual(TEXT("facing independent of travel"),N.Yaw,0.,1e-8);TestNearlyEqual(TEXT("normalized displacement"),(N.Position-S.Position).Size(),.05,1e-8);
 }
 auto Turn=FTVInteractionPrediction::Step(S,{0,0,false,PI/2},1./60,Floor);TestNearlyEqual(TEXT("stationary bounded turn"),Turn.Yaw,TVInteractionSpec::facingRadiansPerSecond/60,1e-8);
 for(int I=0;I<120;++I)S=FTVInteractionPrediction::Posture(S,true,1./60,Floor);TestEqual(TEXT("held posture persists"),S.Crouch,1.);
 auto Slow=FTVInteractionPrediction::Step(S,{0,-1,true,0.},1./60,Floor);TestNearlyEqual(TEXT("crouch excludes sprint"),(Slow.Position-S.Position).Size(),.05*TVInteractionSpec::crouchSpeedMultiplier,1e-8);
 S.Position.Y=1.4;auto Ceiling=[](int,int)->TOptional<FTVPredictionColumn>{return FTVPredictionColumn{1.4,true,{0,3}};};
 TestFalse(TEXT("standing clearance blocked"),FTVInteractionPrediction::PostureFits(S,0,Ceiling));for(int I=0;I<60;++I)S=FTVInteractionPrediction::Posture(S,false,1./60,Ceiling);TestTrue(TEXT("release cannot stand through ceiling"),S.Crouch>0);
 for(const TCHAR* Id:{TEXT("jab"),TEXT("cross"),TEXT("front_kick"),TEXT("round_kick")}){
  const auto& M=TVCombatRepertoire::Move(Id);auto A=FTVLiveCombat::Predict(TEXT("attack"),0,1,Id);A.MoveId=Id;A.Variant=M.Variant;A.ActiveAt=M.preparation;A.RecoveryAt=M.preparation+M.active;A.CompleteAt=A.RecoveryAt+M.recovery;
  const auto P=A.Plan(0);TestTrue(TEXT("semantic asset loads"),LoadObject<UAnimSequence>(nullptr,*P.Motion.AssetPath)!=nullptr);
  TestNearlyEqual(TEXT("authored chain gate"),A.TransitionAge(TEXT("attack")),M.attackAt,1e-8);
  TestTrue(TEXT("active pose remains fully weighted"),P.Weight(float(M.preparation+M.active*.5))>.99f);
 }
 for(const TCHAR* Name:{TEXT("CrouchEnter"),TEXT("CrouchIdle"),TEXT("CrouchMoveF"),TEXT("CrouchMoveB"),TEXT("CrouchMoveL"),TEXT("CrouchMoveR")})TestNotNull(TEXT("owned posture clip"),LoadObject<UAnimSequence>(nullptr,*(FString(TEXT("/Game/TornVeil/Combat/Refinement/Animations/A_TV_"))+Name)));
 return true;
}
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FTVCombatFlowContinuity,"TornVeil.Realtime.Flow.PoseAndTiming",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FTVCombatFlowContinuity::RunTest(const FString&) {
 const FVector Offset(1,2,3),Velocity(-4,5,2);const float Duration=.14f,Epsilon=.00001f;
 TestTrue(TEXT("handoff retains outgoing pose"),TVCombatPoseFlow::Residual(Offset,Velocity,0,Duration).Equals(Offset,1e-6));
 TestTrue(TEXT("handoff retains bounded velocity"),((TVCombatPoseFlow::Residual(Offset,Velocity,Epsilon,Duration)-Offset)/Epsilon).Equals(Velocity,.03));
 TestTrue(TEXT("contact has zero residual"),TVCombatPoseFlow::Residual(Offset,Velocity,Duration,Duration).IsZero());
 TestTrue(TEXT("contact has zero residual velocity"),(TVCombatPoseFlow::Residual(Offset,Velocity,Duration-Epsilon,Duration)/Epsilon).IsNearlyZero(.03));
 for(const TCHAR* Id:{TEXT("jab"),TEXT("cross"),TEXT("front_kick"),TEXT("round_kick")}){
  const auto& M=TVCombatRepertoire::Move(Id);auto A=FTVLiveCombat::Predict(TEXT("attack"),0,1,Id);A.MoveId=Id;A.Variant=M.Variant;A.ActiveAt=M.preparation;A.RecoveryAt=A.ActiveAt+M.active;A.CompleteAt=A.RecoveryAt+M.recovery;
  const auto P=A.Plan(0,true);TestNotNull(TEXT("owned chain derivative loads"),LoadObject<UAnimSequence>(nullptr,*P.Motion.AssetPath));
  TestNearlyEqual(TEXT("chain contact begins at exact authored active sample"),double(P.SampleTime(M.preparation)),M.samplePreparation,.00001);
  TestNearlyEqual(TEXT("chain never fades through idle during recovery"),double(P.Weight(A.CompleteAt-.01)),1.,.00001);
  TestTrue(TEXT("chain does not displace canonical root"),P.Offset(.1).IsNearlyZero());
 }
 const auto& Old=TVCombatRepertoire::Move(TEXT("round_kick"),1);const auto& Now=TVCombatRepertoire::Move(TEXT("round_kick"),2);
 TestNearlyEqual(TEXT("old round save keeps old commitment"),Old.attackAt,.7,1e-8);
 TestTrue(TEXT("round chamber and follow-through have distinct expanded intervals"),Now.preparation>Old.preparation&&Now.recovery>Old.recovery&&Now.attackAt>Old.attackAt);
 TestEqual(TEXT("approved front kick asset preserved"),FString(TVCombatRepertoire::Move(TEXT("front_kick"),1).Asset),FString(TVCombatRepertoire::Move(TEXT("front_kick"),2).Asset));
 return true;
}
#endif
