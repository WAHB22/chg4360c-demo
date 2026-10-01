import plan from "./plan.json";
export const FPS = plan.fps;
export const DURATION = Math.round(plan.dur * FPS);
export const CUE = plan.cue;
export type Plan = typeof plan;
export { plan };
