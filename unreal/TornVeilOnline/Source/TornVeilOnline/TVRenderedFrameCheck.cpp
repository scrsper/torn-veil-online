#include "TVRenderedFrameCheck.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"

FTVRenderedFrameCheck FTVRenderedFrameCheck::Measure(TArrayView64<const FColor> Pixels, int32 Width, int32 Height) {
    FTVRenderedFrameCheck Result;
    if (Width<320 || Height<180 || Pixels.Num()!=int64(Width)*Height) {
        Result.Error=TEXT("Missing or undersized rendered image"); return Result;
    }
    // Exclude top sky/HUD and bottom HUD. A bright HUD/mannequin must not hide a black world.
    int64 Histogram[256]={}, Count=0, Readable=0;
    double Total=0;
    for(int32 Y=Height*.20;Y<Height*.78;++Y) for(int32 X=Width*.08;X<Width*.92;++X) {
        const auto& P=Pixels[int64(Y)*Width+X];
        const double L=(.2126*P.R+.7152*P.G+.0722*P.B)/255.;
        Total+=L; ++Count; ++Histogram[FMath::Clamp(FMath::RoundToInt(L*255),0,255)];
        if(L>=.12) ++Readable;
    }
    auto Percentile=[&](double Fraction) { int64 Sum=0; for(int32 I=0;I<256;++I) { Sum+=Histogram[I]; if(Sum>=Count*Fraction) return I/255.; } return 1.; };
    Result.MeanLuma=Total/Count;
    Result.ReadableFraction=double(Readable)/Count;
    Result.Contrast=Percentile(.90)-Percentile(.10);
    Result.bPassed=Result.MeanLuma>=.10 && Result.ReadableFraction>=.35 && Result.Contrast>=.08;
    if(!Result.bPassed) Result.Error=TEXT("Black/underexposed or blank world ROI: need mean >= .10, fraction at luma >= .12 >= .35, p90-p10 >= .08");
    return Result;
}
FString FTVRenderedFrameCheck::Json() const {
    auto O=MakeShared<FJsonObject>();
    O->SetBoolField(TEXT("passed"),bPassed); O->SetStringField(TEXT("error"),Error);
    O->SetStringField(TEXT("metric"),TEXT("Rec.709 weighted sRGB display values, normalized 0..1"));
    O->SetStringField(TEXT("roi"),TEXT("x=[8%,92%), y=[20%,78%); excludes sky/top and bottom HUD"));
    O->SetNumberField(TEXT("meanLuma"),MeanLuma); O->SetNumberField(TEXT("readableFraction"),ReadableFraction); O->SetNumberField(TEXT("p90MinusP10"),Contrast);
    FString Text; auto Writer=TJsonWriterFactory<>::Create(&Text); FJsonSerializer::Serialize(O,Writer); return Text;
}
