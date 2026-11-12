import { useState } from "react";
import type { MediaSlot } from "../content";

/** Plays the researcher-configured local file, or shows the bundled placeholder until one is supplied. */
export function LocalClip({ slot, testId }: { slot: MediaSlot; testId: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (slot.src) return (
    <>
      <video key={slot.src} src={slot.src} autoPlay playsInline className="local-clip" data-testid={testId}
        onError={() => setFailedSrc(slot.src)} />
      {failedSrc === slot.src ? <p role="alert">The video could not be loaded. Please ask the researcher for help before continuing.</p> : null}
    </>
  );
  return (
    <>
      <img src={slot.placeholder} alt={slot.placeholder_alt} data-testid={testId} />
      <p className="small-note">Local placeholder. Set the approved clip in content/media.json before data collection. No network requests.</p>
    </>
  );
}
