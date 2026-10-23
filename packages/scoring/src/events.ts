export type MenuId = "A" | "B" | "C" | "D" | "E" | "F";
export type StudyId = "pilot" | "s1" | "s2" | "s3";
export type StateLabel = "happy" | "frustrated" | "confused" | "bored" | "mixed";
export type Condition = "static" | "matched" | "mismatched" | "sham" | "hybrid";
export type InputType = "mouse" | "trackpad" | "keyboard" | "touch";

export const EVENT_TYPES = [
  "session_start",
  "consent",
  "demographics",
  "practice_start",
  "block_start",
  "induction_start",
  "induction_end",
  "checkin",
  "trial_start",
  "menu_open",
  "menu_close",
  "node_hover",
  "node_click",
  "leaf_select",
  "product_view",
  "back",
  "search_attempt",
  "timeout",
  "give_up",
  "trial_end",
  "block_end",
  "adaptation_shown",
  "adaptation_accepted",
  "adaptation_reverted",
  "questionnaire",
  "session_end"
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface ResearchEvent {
  event_id: string;
  participant_id: string;
  session_id: string;
  study: StudyId;
  block_id: string | null;
  trial_id: string | null;
  task_id: string | null;
  target_id: string | null;
  menu_id: MenuId | null;
  state_label: StateLabel;
  condition: Condition;
  event_type: EventType;
  t_client: number;
  t_server?: string;
  elapsed_ms: number | null;
  level: 0 | 1 | 2 | 3 | null;
  element_id: string | null;
  element_label: string | null;
  parent_id: string | null;
  x: number | null;
  y: number | null;
  input_type: InputType;
  meta: Record<string, unknown>;
}

export type EventInput = Omit<ResearchEvent, "t_server"> & { t_server?: string };
