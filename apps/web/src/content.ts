import type { StateLabel } from "@meridian/scoring";
import checkin from "../content/checkin.json";
import consent from "../content/consent.json";
import debrief from "../content/debrief.json";
import demographics from "../content/demographics.json";
import inductions from "../content/inductions.json";
import instructions from "../content/instructions.json";
import media from "../content/media.json";
import questionnaires from "../content/questionnaires.json";

// Participant-facing wording lives in ../content/*.json so researchers can edit it without touching components.

export type InductionState = Exclude<StateLabel, "mixed">;

export const CONSENT_VERSION = consent.version;
export const CONSENT_PARAGRAPHS = consent.paragraphs;
export const GAZE_CONSENT_VERSION = consent.gaze.version;
export const GAZE_CONSENT_PARAGRAPHS = consent.gaze.paragraphs;

export const DEMOGRAPHICS = demographics;

// State colours are presentation, not wording, so they stay in code.
const STATE_COLOURS: Record<StateLabel, string> = {
  happy: "#0f766e",
  frustrated: "#b45309",
  confused: "#4338ca",
  bored: "#64748b",
  mixed: "#475569"
};

export const STATE_COPY = Object.fromEntries(
  (Object.keys(STATE_COLOURS) as StateLabel[]).map((state) => [state, { ...inductions.state_labels[state], colour: STATE_COLOURS[state] }])
) as Record<StateLabel, { label: string; short: string; colour: string }>;

export const INDUCTIONS = inductions.inductions;

export const INSTRUCTIONS = instructions;

export interface MediaSlot {
  src: string | null;
  placeholder: string;
  placeholder_alt: string;
}

export const MEDIA: { happy_clip: MediaSlot; neutral_reset_clip: MediaSlot } = media;

export const BASELINE_ITEMS = checkin.baseline_items;
export const STATE_ITEMS = checkin.state_items as Array<{ id: InductionState; label: string }>;

export const SUS_ITEMS = questionnaires.sus;
export const NASA_ITEMS = questionnaires.nasa_tlx;
export const OPEN_QUESTIONS = questionnaires.open;
export const CREDIBILITY_ITEMS = questionnaires.credibility;

export const DEBRIEF_PARAGRAPHS = debrief.paragraphs;
export const TEST_MODE_NOTICE = debrief.test_mode_notice;
