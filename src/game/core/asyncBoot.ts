/**
 * Frame-Budgeted Cooperative Async Boot Scheduler.
 *
 * Yields control back to the browser Event Loop and rendering pipeline so the
 * React LoadingScreen Overlay paints smoothly at 60 FPS while procedural PBR
 * textures, Class-A Hypercar C2 surfaces, SMPL/FLAME character anatomy, and
 * Los Santos district geometry compile progressively.
 */

export interface BootProgressState {
  ready: boolean;
  progress: number; // 0..100
  stageIndex: number;
  totalStages: number;
  stageTitle: string;
  stageDetail: string;
}

export type BootProgressListener = (state: BootProgressState) => void;

const DEFAULT_FRAME_BUDGET_MS = 11.5;
let lastYieldTimestamp = 0;

/**
 * Yields to the browser main thread unconditionally for one frame/task boundary
 * so React and the browser compositor can paint loading progress immediately.
 */
export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          lastYieldTimestamp = performance.now();
          resolve();
        }, 0);
      });
    } else {
      setTimeout(() => {
        lastYieldTimestamp = performance.now();
        resolve();
      }, 0);
    }
  });
}

/**
 * Yields to the browser only when the current synchronous work slice has
 * exceeded `budgetMs` (defaults to ~11.5 ms to maintain 60 FPS).
 */
export async function yieldIfOverBudget(budgetMs = DEFAULT_FRAME_BUDGET_MS): Promise<void> {
  const now = performance.now();
  if (now - lastYieldTimestamp >= budgetMs) {
    await yieldToMainThread();
  }
}

export function resetYieldBudgetClock(): void {
  lastYieldTimestamp = performance.now();
}
