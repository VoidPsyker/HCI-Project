import type { MediaSlot } from "../content";

/** Plays the researcher-configured local file, or shows the bundled placeholder until one is supplied. */
export function LocalClip({ slot, testId }: { slot: MediaSlot; testId: string }) {
  if (slot.src) return <video src={slot.src} autoPlay playsInline className="local-clip" data-testid={testId} />;
  return (
    <>
      <img src={slot.placeholder} alt={slot.placeholder_alt} data-testid={testId} />
      <p className="small-note">Local placeholder. Set the approved clip in content/media.json before data collection. No network requests.</p>
    </>
  );
}
