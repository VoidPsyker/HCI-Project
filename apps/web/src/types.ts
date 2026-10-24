import type { ColourMapping, Difficulty, MenuId, TaxonomyNode } from "@meridian/taxonomy";
import type { StateLabel } from "@meridian/scoring";

export interface SessionInfo {
  session_id: string;
  participant_id: string;
  study: string;
  status: string;
  phase: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  abort_reason: string | null;
  sequence_id: string | null;
  target_set: number | null;
  colour_mapping: ColourMapping | null;
}

export interface ParticipantInfo {
  label: string;
  consent_version: string | null;
  consented_at: string | null;
}

export interface PracticeTrial {
  practiceId: string;
  menuId: MenuId;
  taskId: string;
  targetId: string;
  taskDescription: string;
  difficulty: Difficulty;
}

export interface TrialSpec {
  trialId: string;
  blockId: string;
  blockIndex: number;
  trialIndex: number;
  menuId: MenuId;
  taskId: string;
  targetId: string;
  taskDescription: string;
  difficulty: Difficulty;
  stateLabel: StateLabel;
  condition: "static";
}

export interface BlockSpec {
  blockId: string;
  blockIndex: number;
  stateLabel: StateLabel;
  menuIds: MenuId[];
  trialIds: string[];
}

export interface StudyDesign {
  sessionId: string;
  participantId: string;
  sequenceIndex: number;
  sequenceId: string;
  stratum: string;
  seedHash: string;
  taxonomyHash: string;
  targetSet: number;
  colourMapping: ColourMapping;
  blockOrder: StateLabel[];
  menuOrder: MenuId[];
  blocks: BlockSpec[];
  practiceTrials: PracticeTrial[];
  trials: TrialSpec[];
  createdAt: string;
}

export interface SessionBundle {
  session: SessionInfo;
  participant: ParticipantInfo | null;
  design: StudyDesign | null;
}

export interface CheckinPayload {
  phase: "baseline" | "post_induction" | "post_trials";
  valence: number;
  arousal: number;
  happy: number;
  frustrated: number;
  confused: number;
  bored: number;
  distress: number;
  fatigue: number;
  dominant_state: string;
  intensity: number;
}

export interface AdminSession {
  session_id: string;
  participant_id: string;
  label: string;
  status: string;
  phase: string;
  sequence_index: number | null;
  sequence_id: string | null;
  stratum: string | null;
  target_set: number | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  last_event_at: string | null;
  event_count: number;
  trial_count: number;
  questionnaire_count: number;
  latest_event_type: string | null;
  latest_trial_id: string | null;
  latest_menu_id: string | null;
  latest_state_label: string | null;
  checkin_distress: number | null;
  checkin_dominant_state: string | null;
  stuck_seconds: number | null;
}

export interface QaCriterion {
  id: string;
  label: string;
  status: "pass" | "fail" | "na";
  value: string;
  threshold: string;
  note?: string;
}

export interface QaReport {
  generated_at: string;
  sessions: { total: number; completed: number; in_progress: number; aborted: number };
  counts: { events: number; trials: number; main_trials: number; practice_trials: number; questionnaires: number; checkins: number };
  data_quality: Record<string, number | null>;
  criteria: QaCriterion[];
  overall: "pass" | "fail" | "conditional";
}

export interface MenuProps {
  menuId: MenuId;
  colourMapping: ColourMapping;
  onLeafSelect: (leaf: TaxonomyNode, inputType?: "keyboard" | "mouse") => void;
  onEvent: (type: string, payload?: Record<string, unknown>) => void;
  disabled?: boolean;
}
