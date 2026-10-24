import type { StateLabel } from "@meridian/scoring";

export const CONSENT_VERSION = "pilot-consent-placeholder-v2";
export const GAZE_CONSENT_VERSION = "pilot-gaze-consent-placeholder-v1";

export const CONSENT_PARAGRAPHS = [
  "This is a placeholder consent form for the Meridian Timepieces pilot. It must be replaced with the approved ethics documentation before any real participant takes part.",
  "You are invited to take part in a study about how the organisation of an online watch catalogue affects searching. The session takes up to 100 minutes. You will browse a fictional store, complete short check-ins about how you feel, and answer questionnaires.",
  "The study also uses webcam-based eye tracking during the scored search trials. That needs a separate consent step after this one, and you can refuse it; refusing ends the session before the scored trials. Gaze positions and timing are stored separately from your clicks and questionnaire answers. Raw video is never recorded or stored, and the study does not infer emotion from your face or gaze.",
  "Your responses are pseudonymous: we store a participant code, not your name. Interaction events, questionnaire answers, and separate gaze files are stored on this research computer. Gaze files have restricted researcher access and are deleted if you withdraw.",
  "You can pause or stop at any time without giving a reason. If you feel uncomfortable, choose the visible Stop control and the session will end immediately with a debrief. You may withdraw your data at the end of the session.",
  "There are no known physical risks. Some induction tasks are deliberately mildly frustrating, confusing, or boring. They last at most 2.5 minutes and are followed by a check-in and a neutral reset.",
  "By continuing you confirm that you have read this placeholder information, that your questions have been answered, and that you agree to take part."
];

export const GAZE_CONSENT_PARAGRAPHS = [
  "This is a separate consent for eye tracking. The core study consent above is not enough on its own.",
  "The pilot uses the camera in this computer to estimate where you look during the scored search trials. The camera starts only after you agree here. It does not record video, images, or audio, and no face images leave the browser.",
  "Gaze coordinates, timing, calibration results, and measured screen geometry are stored in a separate restricted dataset. They are not mixed into the click-event log or questionnaire tables. Researchers can export them only from the password-protected console.",
  "Webcam eye tracking is less accurate than a dedicated research tracker. A measured nine-point calibration and held-out validation decide whether the session can continue. If the error is above 1.5° or cannot be evaluated, the scored trials cannot run.",
  "You can refuse now and end the session, or stop at any time. Withdrawal deletes the gaze files together with the rest of the session data."
];

export const DEMOGRAPHICS = {
  age_band: ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"],
  gender: ["woman", "man", "non-binary", "prefer not to say", "self-describe"],
  education: ["secondary", "vocational", "undergraduate", "postgraduate", "doctorate", "prefer not to say"],
  shopping_freq: ["never", "rarely", "monthly", "weekly", "daily"],
  colour_vision: ["typical", "corrected", "atypical", "prefer not to say"]
};

export const STATE_COPY: Record<StateLabel, { label: string; short: string; colour: string }> = {
  happy: { label: "Happy / excited", short: "Happy", colour: "#0f766e" },
  frustrated: { label: "Frustrated / annoyed", short: "Frustrated", colour: "#b45309" },
  confused: { label: "Confused / lost", short: "Confused", colour: "#4338ca" },
  bored: { label: "Bored / disengaged", short: "Bored", colour: "#64748b" },
  mixed: { label: "Neutral / mixed", short: "Neutral", colour: "#475569" }
};

export interface InductionDefinition {
  state: StateLabel;
  title: string;
  intro: string;
  task: string;
  durationSeconds: number;
}

export const INDUCTIONS: Record<Exclude<StateLabel, "mixed">, InductionDefinition> = {
  happy: {
    state: "happy",
    title: "A pleasant browsing moment",
    intro:
      "Imagine you have just found a watch you love and the site is celebrating with you. Watch the short local clip and let the mood settle. There is nothing to solve here.",
    task: "Watch the local clip. When the timer ends, continue to the check-in.",
    durationSeconds: 90
  },
  frustrated: {
    state: "frustrated",
    title: "The search that will not cooperate",
    intro:
      "Use the search box to look for the watch described below. The search is intentionally unreliable in this pilot. You may try up to three times; it is fine to stop early.",
    task: "Search for: a 42 mm automatic dive watch with a blue dial and a titanium strap.",
    durationSeconds: 90
  },
  confused: {
    state: "confused",
    title: "Which category is right?",
    intro:
      "The labels below overlap and none of them clearly matches the target. Choose the category you think is closest. There is no feedback, and you can change your mind.",
    task: "Target: a watch that is formal enough for a dinner, but rugged enough for a hike.",
    durationSeconds: 90
  },
  bored: {
    state: "bored",
    title: "The very repetitive catalogue check",
    intro:
      "This is a deliberately dull quality-control task. Confirm the listed price for each strap. You do not need to finish; the timer will end the task.",
    task: "Verify the price of each strap in the list. The same value repeats.",
    durationSeconds: 90
  }
};

export const BASELINE_ITEMS = [
  { id: "valence", label: "How pleasant do you feel right now?", min: 1, max: 9, low: "Very unpleasant", high: "Very pleasant" },
  { id: "arousal", label: "How activated or alert do you feel?", min: 1, max: 9, low: "Very calm", high: "Very activated" }
];

export const STATE_ITEMS: Array<{ id: "happy" | "frustrated" | "confused" | "bored"; label: string }> = [
  { id: "happy", label: "Happy / excited" },
  { id: "frustrated", label: "Frustrated / annoyed" },
  { id: "confused", label: "Confused / lost" },
  { id: "bored", label: "Bored / disengaged" }
];

export const SUS_ITEMS = [
  "I think that I would like to use this menu frequently.",
  "I found the menu unnecessarily complex.",
  "I thought the menu was easy to use.",
  "I think that I would need the support of a technical person to be able to use this menu.",
  "I found the various functions in this menu were well integrated.",
  "I thought there was too much inconsistency in this menu.",
  "I would imagine that most people would learn to use this menu very quickly.",
  "I found the menu very cumbersome to use.",
  "I felt very confident using the menu.",
  "I needed to learn a lot of things before I could get going with this menu."
];

export const NASA_ITEMS = [
  { id: "mental_demand", label: "Mental demand", low: "Low", high: "High" },
  { id: "physical_demand", label: "Physical demand", low: "Low", high: "High" },
  { id: "temporal_demand", label: "Temporal demand", low: "Low", high: "High" },
  { id: "performance", label: "Performance", low: "Perfect", high: "Failure" },
  { id: "effort", label: "Effort", low: "Low", high: "High" },
  { id: "frustration", label: "Frustration", low: "Low", high: "High" }
];

export const OPEN_QUESTIONS = [
  { id: "strategy", label: "What strategy did you use to find products?" },
  { id: "frustration", label: "Which moment, if any, felt most frustrating or confusing?" },
  { id: "suggestions", label: "What would you change about the menus?" }
];

export const CREDIBILITY_ITEMS = [
  { id: "credible", label: "The emotional scenario felt credible." },
  { id: "immersed", label: "I was absorbed in the scenario." },
  { id: "distracted", label: "I was distracted by the interface." },
  { id: "real", label: "The scenario felt like a real browsing situation." }
];

export const DEBRIEF_PARAGRAPHS = [
  "Thank you. This pilot tests a fictional watch store and several menu layouts. We are checking whether the procedures, menus, and measures are usable before a larger study.",
  "Some tasks were designed to be mildly frustrating, confusing, or boring. Those feelings were part of the procedure, not a judgement of you. The check-ins and neutral resets were there to bring you back to baseline.",
  "We used webcam-based eye tracking during the scored search trials, with separate consent. No video, images, audio, or automated emotion detection were stored or inferred. Gaze data are kept in a separate restricted dataset and are pseudonymous. You can withdraw your data now or ask the researcher to remove it later.",
  "If you feel unwell or distressed, please tell the researcher. You can stop at any point. Contact details for support should be inserted here after ethics approval.",
  "This is a pilot build. Ethics approval is required before any real participant takes part."
];

export const TEST_MODE_NOTICE = "Test mode: timers are shortened. Do not use for real participants.";
