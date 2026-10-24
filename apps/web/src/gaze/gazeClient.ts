import type {
  CalibrationReport,
  ClockSyncReport,
  GazeConsent,
  GazeQualityReport,
  GazeSample,
  GazeSourceInfo,
  ScreenGeometry,
  TrialGazeMetrics,
  Viewport
} from "@meridian/analysis";
import { API_BASE, request } from "../api";

export interface GazeConsentResponse {
  ok: boolean;
  session_id: string;
  synthetic: boolean;
  token: string;
  consent: {
    version: string;
    granted_at: string;
    scope: "eye_tracking_only";
    camera_used: boolean;
    raw_video_retention: false;
    separate_from_core_consent: true;
  };
}

export interface GazeBatch {
  batch_id: string;
  samples: GazeSample[];
}

export interface GazeBatchResponse {
  ok: boolean;
  accepted: number;
  duplicate: boolean;
  last_seq: number;
}

export interface GazeCompletionPayload {
  calibration: CalibrationReport | null;
  quality: GazeQualityReport;
  metrics: readonly TrialGazeMetrics[];
  clock: ClockSyncReport;
  max_samples: number;
  rejected_samples: number;
  dropped_samples: number;
}

export interface GazeCompleteResponse {
  ok: boolean;
  manifest: Record<string, unknown>;
  sample_count: number;
  files: string[];
}

export interface GazeApi {
  consent(input: {
    session_id: string;
    version: string;
    camera_used: boolean;
    synthetic: boolean;
    viewport: Viewport;
    geometry: ScreenGeometry;
    source: GazeSourceInfo;
  }): Promise<GazeConsentResponse>;
  batch(sessionId: string, token: string, batch: GazeBatch): Promise<GazeBatchResponse>;
  complete(sessionId: string, token: string, payload: GazeCompletionPayload): Promise<GazeCompleteResponse>;
}

export const gazeApi: GazeApi = {
  consent(input) {
    return request<GazeConsentResponse>(`/api/gaze/sessions/${encodeURIComponent(input.session_id)}/consent`, {
      method: "POST",
      body: JSON.stringify({
        version: input.version,
        camera_used: input.camera_used,
        synthetic: input.synthetic,
        viewport: input.viewport,
        geometry: input.geometry,
        source: input.source
      })
    });
  },
  batch(sessionId, token, batch) {
    return request<GazeBatchResponse>(`/api/gaze/sessions/${encodeURIComponent(sessionId)}/batches`, {
      method: "POST",
      headers: { "x-gaze-token": token },
      body: JSON.stringify(batch)
    });
  },
  complete(sessionId, token, payload) {
    return request<GazeCompleteResponse>(`/api/gaze/sessions/${encodeURIComponent(sessionId)}/complete`, {
      method: "POST",
      headers: { "x-gaze-token": token },
      body: JSON.stringify(payload)
    });
  }
};

function uuid(): string {
  const value = globalThis.crypto?.randomUUID?.();
  if (value) return value;
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const digit = character === "x" ? random : (random & 0x3) | 0x8;
    return digit.toString(16);
  });
}

export interface GazeUploaderOptions {
  sessionId: string;
  token: string;
  postBatch: (sessionId: string, token: string, batch: GazeBatch) => Promise<GazeBatchResponse>;
  batchSize?: number;
  maxQueue?: number;
  autoFlushMs?: number | null;
  wait?: (milliseconds: number) => Promise<void>;
  onError?: (message: string | null) => void;
}

/**
 * Bounded, idempotent uploader. A failed batch keeps its batch id so a retry is
 * deduplicated by the server; the queue never silently drops samples. If the
 * queue fills, ingestion becomes a visible fatal error and completion is
 * refused rather than pretending the data are complete.
 */
export class GazeUploader {
  private readonly sessionId: string;
  private readonly token: string;
  private readonly postBatch: GazeUploaderOptions["postBatch"];
  private readonly batchSize: number;
  private readonly maxQueue: number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly onError?: (message: string | null) => void;
  private queue: GazeSample[] = [];
  private pending: GazeBatch | null = null;
  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastError: string | null = null;
  private fatalError: string | null = null;

  constructor(options: GazeUploaderOptions) {
    this.sessionId = options.sessionId;
    this.token = options.token;
    this.postBatch = options.postBatch;
    this.batchSize = options.batchSize ?? 250;
    this.maxQueue = options.maxQueue ?? 20_000;
    this.wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.onError = options.onError;
    if (!Number.isInteger(this.batchSize) || this.batchSize <= 0) throw new Error("gaze_batch_size_invalid");
    if (!Number.isInteger(this.maxQueue) || this.maxQueue < this.batchSize) throw new Error("gaze_max_queue_invalid");
    if (options.autoFlushMs !== null) {
      this.timer = setInterval(() => {
        void this.flush().catch(() => undefined);
      }, options.autoFlushMs ?? 2_000);
    }
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get error(): string | null {
    return this.fatalError ?? this.lastError;
  }

  get overflowed(): boolean {
    return this.fatalError !== null;
  }

  push(sample: GazeSample): boolean {
    if (this.fatalError) return false;
    if (this.queue.length >= this.maxQueue) {
      this.fatalError = "gaze_upload_queue_overflow";
      this.setError(this.fatalError);
      return false;
    }
    this.queue.push(sample);
    if (this.queue.length >= this.batchSize) void this.flush().catch(() => undefined);
    return true;
  }

  private setError(message: string | null): void {
    if (this.lastError === message) return;
    this.lastError = message;
    this.onError?.(message);
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const batch =
        this.pending ??
        ({
          batch_id: uuid(),
          samples: this.queue.slice(0, this.batchSize)
        } satisfies GazeBatch);
      this.pending = batch;
      try {
        await this.postBatch(this.sessionId, this.token, batch);
      } catch (error) {
        this.setError(error instanceof Error ? error.message : "gaze_upload_failed");
        throw error;
      }
      this.queue.splice(0, batch.samples.length);
      this.pending = null;
      this.setError(null);
    }
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.drain().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  async flushAll(retries = 3, delayMs = 500): Promise<void> {
    let last: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        await this.flush();
        if (this.queue.length === 0) return;
      } catch (error) {
        last = error;
      }
      if (attempt < retries) await this.wait(delayMs);
    }
    throw last instanceof Error ? last : new Error("gaze_upload_failed");
  }

  /** Best-effort same-origin flush during pagehide; the batch id is preserved. */
  flushKeepalive(): void {
    if (this.queue.length === 0 || this.flushing) return;
    const batch =
      this.pending ??
      ({
        batch_id: uuid(),
        samples: this.queue.slice(0, this.batchSize)
      } satisfies GazeBatch);
    this.pending = batch;
    void fetch(`${API_BASE}/api/gaze/sessions/${encodeURIComponent(this.sessionId)}/batches`, {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json", "x-gaze-token": this.token },
      body: JSON.stringify(batch)
    }).catch(() => undefined);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  clear(): void {
    this.stop();
    this.queue = [];
    this.pending = null;
    this.lastError = null;
    this.fatalError = null;
  }
}
