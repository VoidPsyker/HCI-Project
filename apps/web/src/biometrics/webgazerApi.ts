import type { GazeSample, GazeSourceInfo, GazeSourceStatus } from "@meridian/analysis";
import { ClockSynchronizer } from "@meridian/analysis";

export interface WebGazerGazeData {
  x: number;
  y: number;
}

export interface WebGazerParams {
  faceMeshSolutionPath: string;
  saveDataAcrossSessions: boolean;
  showVideo: boolean;
  showFaceOverlay: boolean;
  showFaceFeedbackBox: boolean;
  showGazeDot: boolean;
  applyKalmanFilter: boolean;
  storingPoints: boolean;
}

export interface WebGazerTracker {
  getEyePatches(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    width: number,
    height: number
  ): Promise<unknown> | unknown;
}

export interface WebGazerApi {
  params: WebGazerParams;
  getTracker?(): WebGazerTracker;
  begin(onFail?: () => void): Promise<WebGazerApi> | WebGazerApi;
  end(): WebGazerApi;
  stopVideo(): WebGazerApi;
  pause(): WebGazerApi;
  resume(): Promise<WebGazerApi> | WebGazerApi;
  setGazeListener(listener: (data: WebGazerGazeData | null, elapsedTime: number) => void): WebGazerApi;
  clearGazeListener(): WebGazerApi;
  clearData(): Promise<void> | void;
  removeMouseEventListeners?(): void;
  addMouseEventListeners?(): WebGazerApi;
  recordScreenPosition?(x: number, y: number, eventType?: "click" | "move"): void;
  detectCompatibility?(): boolean;
}

export interface GazeSourceRuntimeInfo {
  info: GazeSourceInfo;
  status: GazeSourceStatus;
  clock: ReturnType<ClockSynchronizer["report"]>;
  subscribe(listener: (sample: GazeSample) => void): () => void;
}
