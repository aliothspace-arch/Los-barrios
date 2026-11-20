/**
 * Deterministic fixed-timestep simulation clock.
 * Replaces wall-clock `Date.now()` inside gameplay/AI simulation so physics,
 * NPC routines, and unit tests are 100% reproducible.
 */
export class SimulationClock {
  public readonly fixedDt: number;
  public readonly maxFrameDt: number;
  public readonly maxSubsteps: number;

  private accumulator = 0;
  private simTimeSec = 0;
  private frameCount = 0;

  constructor(fixedDt = 1 / 60, maxFrameDt = 0.05, maxSubsteps = 4) {
    this.fixedDt = fixedDt;
    this.maxFrameDt = maxFrameDt;
    this.maxSubsteps = maxSubsteps;
  }

  public get timeSec(): number {
    return this.simTimeSec;
  }

  public get ticks(): number {
    return this.frameCount;
  }

  /** Fractional progress (0..1) toward the next fixed simulation step for smooth presentation interpolation. */
  public get alpha(): number {
    return Math.min(1, Math.max(0, this.accumulator / this.fixedDt));
  }

  public reset(): void {
    this.accumulator = 0;
    this.simTimeSec = 0;
    this.frameCount = 0;
  }

  /**
   * Advances simulation in clamped fixed increments and returns the number
   * of fixed substeps executed this frame.
   */
  public advance(rawDt: number, onStep: (dt: number, simTimeSec: number) => void): number {
    const clampedDt = Math.min(Math.max(0, rawDt), this.maxFrameDt);
    this.accumulator += clampedDt;
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxSubsteps) {
      this.simTimeSec += this.fixedDt;
      this.frameCount++;
      onStep(this.fixedDt, this.simTimeSec);
      this.accumulator -= this.fixedDt;
      steps++;
    }
    if (steps === this.maxSubsteps && this.accumulator > this.fixedDt) {
      this.accumulator = 0;
    }
    return steps;
  }
}
