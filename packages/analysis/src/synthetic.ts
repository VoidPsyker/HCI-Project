import { ClockSynchronizer } from "./clock";
import type { ClockSyncReport } from "./clock";
import type {
  GazeConsent,
  GazeSample,
  GazeSampleListener,
  GazeSource,
  GazeSourceInfo,
  GazeSourceStatus,
  ScreenGeometry,
  Viewport
} from "./types";

export interface SyntheticReplaySample {
  t_source_ms: number;
  x_px: number | null;
  y_px: number | null;
  valid?: boolean;
  invalid_reason?: GazeSample["invalid_reason"];
  pupil_left_mm?: number | null;
  pupil_right_mm?: number | null;
}

/**
 * Test/replay-only recording. The literal `synthetic: true` and `provenance`
 * fields make accidental use as participant data a type error.
 */
export interface SyntheticReplayRecording {
  kind: "synthetic_replay";
  synthetic: true;
  provenance: "synthetic";
  description: string;
  source: GazeSourceInfo;
  viewport: Viewport;
  geometry: ScreenGeometry | null;
  samples: readonly SyntheticReplaySample[];
}

export function isSyntheticReplayRecording(value: unknown): value is SyntheticReplayRecording {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SyntheticReplayRecording>;
  return candidate.kind === "synthetic_replay" && candidate.synthetic === true && candidate.provenance === "synthetic";
}

function assertRecording(recording: SyntheticReplayRecording): void {
  if (!isSyntheticReplayRecording(recording)) throw new Error("synthetic_replay_marker_required");
  if (recording.source.kind !== "synthetic" || recording.source.synthetic !== true) {
    throw new Error("synthetic_replay_source_invalid");
  }
  if (!recording.description.trim()) throw new Error("synthetic_replay_description_required");
  if (!Number.isFinite(recording.viewport.width_px) || recording.viewport.width_px <= 0) throw new Error("viewport_width_invalid");
  if (!Number.isFinite(recording.viewport.height_px) || recording.viewport.height_px <= 0) throw new Error("viewport_height_invalid");
  for (const sample of recording.samples) {
    if (!Number.isFinite(sample.t_source_ms)) throw new Error("synthetic_replay_time_invalid");
    const hasPoint = sample.x_px !== null && sample.y_px !== null;
    if (hasPoint && (!Number.isFinite(sample.x_px) || !Number.isFinite(sample.y_px))) {
      throw new Error("synthetic_replay_point_invalid");
    }
  }
}

/** Replays synthetic samples onto a same-clock timeline. Never camera data. */
export function replaySyntheticRecording(recording: SyntheticReplayRecording): GazeSample[] {
  assertRecording(recording);
  return recording.samples.map((sample, index) => {
    const valid =
      sample.valid ?? (sample.x_px !== null && sample.y_px !== null && Number.isFinite(sample.x_px) && Number.isFinite(sample.y_px));
    return {
      seq: index + 1,
      t_ms: sample.t_source_ms,
      t_source_ms: sample.t_source_ms,
      x_px: sample.x_px,
      y_px: sample.y_px,
      valid,
      ...(sample.invalid_reason ? { invalid_reason: sample.invalid_reason } : {}),
      ...(sample.pupil_left_mm === undefined ? {} : { pupil_left_mm: sample.pupil_left_mm }),
      ...(sample.pupil_right_mm === undefined ? {} : { pupil_right_mm: sample.pupil_right_mm }),
      trial_id: null
    };
  });
}

export class SyntheticGazeSource implements GazeSource {
  readonly info: GazeSourceInfo;
  private readonly recording: SyntheticReplayRecording;
  private readonly clockSync = ClockSynchronizer.sameClock();
  private listeners = new Set<GazeSampleListener>();
  private state: GazeSourceStatus = "idle";
  private emitted = false;

  constructor(recording: SyntheticReplayRecording) {
    assertRecording(recording);
    this.recording = recording;
    this.info = { ...recording.source, kind: "synthetic", synthetic: true, hardware_backed: false };
  }

  get status(): GazeSourceStatus {
    return this.state;
  }

  get clock(): ClockSyncReport {
    return this.clockSync.report();
  }

  async start(_consent: GazeConsent | null): Promise<void> {
    if (this.emitted) return;
    this.state = "running";
    this.emitted = true;
    for (const sample of replaySyntheticRecording(this.recording)) {
      for (const listener of this.listeners) listener(sample);
    }
    this.state = "stopped";
  }

  async stop(): Promise<void> {
    this.state = "stopped";
  }

  async pause(): Promise<void> {
    if (this.state === "running") this.state = "paused";
  }

  async resume(): Promise<void> {
    if (this.state === "paused") this.state = "running";
  }

  subscribe(listener: GazeSampleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
