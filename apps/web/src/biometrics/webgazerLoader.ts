import type { WebGazerApi } from "./webgazerApi";

/** Vite-bundled local WebGazer. The MediaPipe assets are served from public/. */
export async function loadBundledWebGazer(): Promise<WebGazerApi> {
  const module = await import("webgazer");
  return (module as { default?: WebGazerApi }).default ?? (module as unknown as WebGazerApi);
}
