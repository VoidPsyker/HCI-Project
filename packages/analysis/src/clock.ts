export type ClockSyncMethod = "same_clock" | "observed_arrival" | "ping_pong";

export interface ClockPair {
  source_ms: number;
  local_ms: number;
  rtt_ms?: number;
}

export interface ClockSyncReport {
  method: ClockSyncMethod;
  pairs: number;
  offset_ms: number | null;
  drift_ppm: number | null;
  residual_ms: number | null;
  max_residual_ms: number | null;
  median_rtt_ms: number | null;
  uncertainty_ms: number | null;
  synchronized: boolean;
  note: string;
}

export interface PingPongExchange {
  t0_local_ms: number;
  t1_source_ms: number;
  t2_source_ms: number;
  t3_local_ms: number;
}

export interface PingPongEstimate {
  source_ms: number;
  local_ms: number;
  offset_ms: number;
  rtt_ms: number;
}

/** NTP-style offset estimate from a four-timestamp exchange. */
export function pingPongEstimate(exchange: PingPongExchange): PingPongEstimate {
  const { t0_local_ms: t0, t1_source_ms: t1, t2_source_ms: t2, t3_local_ms: t3 } = exchange;
  if (![t0, t1, t2, t3].every(Number.isFinite)) throw new Error("clock_exchange_non_finite");
  if (t1 > t2) throw new Error("clock_exchange_source_order_invalid");
  if (t3 < t0) throw new Error("clock_exchange_local_order_invalid");
  return {
    source_ms: (t1 + t2) / 2,
    local_ms: (t0 + t3) / 2,
    offset_ms: (t1 - t0 + (t2 - t3)) / 2,
    rtt_ms: Math.max(0, t3 - t0 - (t2 - t1))
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? null);
}

/**
 * Linear source→local clock mapper. Drift is estimated only when the pairs
 * span a non-zero source interval; otherwise the slope is fixed at 1.
 */
export class ClockSynchronizer {
  private readonly pairs: ClockPair[] = [];
  private readonly method: ClockSyncMethod;
  private readonly maxPairs: number;

  constructor(method: ClockSyncMethod = "observed_arrival", maxPairs = 500) {
    this.method = method;
    this.maxPairs = Math.max(2, maxPairs);
  }

  reset(): void {
    this.pairs.length = 0;
  }

  addPair(sourceMs: number, localMs: number, rttMs?: number): void {
    if (!Number.isFinite(sourceMs) || !Number.isFinite(localMs)) throw new Error("clock_pair_non_finite");
    if (rttMs !== undefined && (!Number.isFinite(rttMs) || rttMs < 0)) throw new Error("clock_rtt_invalid");
    this.pairs.push({ source_ms: sourceMs, local_ms: localMs, ...(rttMs === undefined ? {} : { rtt_ms: rttMs }) });
    if (this.pairs.length > this.maxPairs) this.pairs.shift();
  }

  /** Same-clock source (for synthetic/replay data only). */
  static sameClock(): ClockSynchronizer {
    const clock = new ClockSynchronizer("same_clock", 2);
    clock.addPair(0, 0, 0);
    clock.addPair(1, 1, 0);
    return clock;
  }

  private regression(): { intercept: number; slope: number } | null {
    if (this.pairs.length === 0) return null;
    if (this.pairs.length === 1) {
      const pair = this.pairs[0]!;
      return { intercept: pair.local_ms - pair.source_ms, slope: 1 };
    }
    const n = this.pairs.length;
    let sumX = 0;
    let sumY = 0;
    for (const pair of this.pairs) {
      sumX += pair.source_ms;
      sumY += pair.local_ms;
    }
    const meanX = sumX / n;
    const meanY = sumY / n;
    let cov = 0;
    let varX = 0;
    for (const pair of this.pairs) {
      const dx = pair.source_ms - meanX;
      cov += dx * (pair.local_ms - meanY);
      varX += dx * dx;
    }
    if (varX <= Number.EPSILON) return { intercept: meanY - meanX, slope: 1 };
    const slope = cov / varX;
    return { intercept: meanY - slope * meanX, slope };
  }

  toLocal(sourceMs: number): number {
    const model = this.regression();
    if (!model) throw new Error("clock_not_synchronized");
    return model.intercept + model.slope * sourceMs;
  }

  toSource(localMs: number): number {
    const model = this.regression();
    if (!model) throw new Error("clock_not_synchronized");
    if (Math.abs(model.slope) <= Number.EPSILON) throw new Error("clock_slope_invalid");
    return (localMs - model.intercept) / model.slope;
  }

  report(): ClockSyncReport {
    const model = this.regression();
    if (!model) {
      return {
        method: this.method,
        pairs: 0,
        offset_ms: null,
        drift_ppm: null,
        residual_ms: null,
        max_residual_ms: null,
        median_rtt_ms: null,
        uncertainty_ms: null,
        synchronized: false,
        note: "No clock pairs observed; device timestamps cannot be mapped."
      };
    }
    let sumSq = 0;
    let maxResidual = 0;
    for (const pair of this.pairs) {
      const residual = model.intercept + model.slope * pair.source_ms - pair.local_ms;
      sumSq += residual * residual;
      maxResidual = Math.max(maxResidual, Math.abs(residual));
    }
    const rms = Math.sqrt(sumSq / this.pairs.length);
    const rtts = this.pairs.flatMap((pair) => (pair.rtt_ms === undefined ? [] : [pair.rtt_ms]));
    const rttMedian = median(rtts);
    const uncertainty = Math.sqrt(rms * rms + (rttMedian === null ? 0 : (rttMedian / 2) ** 2));
    return {
      method: this.method,
      pairs: this.pairs.length,
      offset_ms: model.intercept,
      drift_ppm: (model.slope - 1) * 1_000_000,
      residual_ms: rms,
      max_residual_ms: maxResidual,
      median_rtt_ms: rttMedian,
      uncertainty_ms: uncertainty,
      synchronized: this.pairs.length >= 2 && Number.isFinite(model.slope),
      note:
        this.method === "same_clock"
          ? "Source and capture share a clock; no mapping uncertainty."
          : "Clock offset/drift estimated from observed timestamps; uncertainty is reported, not hidden."
    };
  }
}
