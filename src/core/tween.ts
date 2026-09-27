// Frame-driven tweens and timers that resolve promises, so battle choreography can be written with async/await.

export type Ease = (t: number) => number;
export const ease = {
  linear: (t: number) => t,
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  in: (t: number) => t * t * t,
  back: (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};

interface Job {
  elapsed: number;
  duration: number;
  step: (t: number) => void;
  easing: Ease;
  resolve: () => void;
  realtime: boolean;
}

class Tweener {
  private jobs: Job[] = [];
  /** Global time scale for game-time jobs (slow-mo on perfect parry). */
  timeScale = 1;

  tween(duration: number, step: (t: number) => void, easing: Ease = ease.inOut, realtime = false): Promise<void> {
    return new Promise((resolve) => {
      if (duration <= 0) { step(1); resolve(); return; }
      this.jobs.push({ elapsed: 0, duration, step, easing, resolve, realtime });
    });
  }

  wait(ms: number, realtime = false): Promise<void> {
    return this.tween(ms / 1000, () => {}, ease.linear, realtime);
  }

  private frameWaiters: ((dt: number) => void)[] = [];

  /** Resolves on the next frame with that frame's (scaled) dt. */
  frame(): Promise<number> { return new Promise((r) => this.frameWaiters.push(r)); }

  update(dt: number) {
    const fw = this.frameWaiters;
    this.frameWaiters = [];
    fw.forEach((r) => r(dt * this.timeScale));
    const jobs = this.jobs;
    this.jobs = [];
    const keep: Job[] = [];
    for (const j of jobs) {
      j.elapsed += j.realtime ? dt : dt * this.timeScale;
      const t = Math.min(1, j.elapsed / j.duration);
      j.step(j.easing(t));
      if (t >= 1) j.resolve();
      else keep.push(j);
    }
    // jobs added during step() callbacks were pushed to this.jobs
    this.jobs = keep.concat(this.jobs);
  }

  clear() { this.jobs = []; }
}

export const tweens = new Tweener();
export const wait = (ms: number) => tweens.wait(ms);
export const nextFrame = () => tweens.frame();
