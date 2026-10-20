export interface HumanMotionManifest {
  id: string; file: string; sha256: string; bytes: number; license: string; url: string;
}
export const humanMotionSource: HumanMotionManifest;
export function stageHumanMotion(options?: {
  output?: string; sources?: string[]; manifest?: HumanMotionManifest;
}): HumanMotionManifest;
