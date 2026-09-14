#pragma once
#include "CoreMinimal.h"

/** Conservative display-space readability gate, not an art-quality or FPS score. */
struct FTVRenderedFrameCheck {
    bool bPassed=false;
    double MeanLuma=0, ReadableFraction=0, Contrast=0;
    FString Error;
    static FTVRenderedFrameCheck Measure(TArrayView64<const FColor> Pixels, int32 Width, int32 Height);
    FString Json() const;
};
