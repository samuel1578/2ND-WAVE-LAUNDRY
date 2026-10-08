export const ENTER_EARLY = 0.22;
export const ENTER_DONE = 0.4;
export const FINAL_EARLY = 0.58;
export const FINAL_DONE = 0.76;

// Discrete stage switches sit at the midpoint of each cross-fade so the
// inert/aria-hidden handover happens while content is barely visible.
export const STAGE_BREAKS = [0.31, 0.67] as const;

export function stageFromProgress(progress: number): number {
  if (progress < STAGE_BREAKS[0]) return 0;
  if (progress < STAGE_BREAKS[1]) return 1;
  return 2;
}
