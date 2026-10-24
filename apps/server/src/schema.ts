export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS participants (
  participant_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consent_version TEXT,
  consented_at TEXT,
  age_band TEXT,
  gender TEXT,
  education TEXT,
  shopping_freq TEXT,
  watch_expertise TEXT,
  tech_savvy TEXT,
  colour_vision TEXT,
  withdrawn_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
  study TEXT NOT NULL DEFAULT 'pilot',
  status TEXT NOT NULL DEFAULT 'created',
  phase TEXT NOT NULL DEFAULT 'consent',
  sequence_index INTEGER,
  sequence_id TEXT,
  stratum TEXT,
  target_set INTEGER,
  seed_hash TEXT,
  taxonomy_hash TEXT,
  design_json TEXT,
  colour_mapping TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  last_event_at TEXT,
  abort_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_stratum ON sessions(stratum);

CREATE TABLE IF NOT EXISTS assignments_audit (
  participant_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  sequence_index INTEGER NOT NULL,
  sequence_id TEXT NOT NULL,
  stratum TEXT NOT NULL,
  block_order TEXT NOT NULL,
  menu_orders TEXT NOT NULL,
  target_set INTEGER NOT NULL,
  colour_mapping TEXT NOT NULL,
  seed_hash TEXT NOT NULL,
  taxonomy_hash TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  design_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  study TEXT NOT NULL,
  block_id TEXT,
  trial_id TEXT,
  task_id TEXT,
  target_id TEXT,
  menu_id TEXT,
  state_label TEXT NOT NULL,
  condition TEXT NOT NULL,
  event_type TEXT NOT NULL,
  t_client REAL NOT NULL,
  t_server TEXT NOT NULL,
  elapsed_ms REAL,
  level INTEGER,
  element_id TEXT,
  element_label TEXT,
  parent_id TEXT,
  x REAL,
  y REAL,
  input_type TEXT NOT NULL,
  meta_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_trial ON events(trial_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_server_time ON events(t_server);

CREATE TABLE IF NOT EXISTS trials (
  trial_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  block_id TEXT,
  trial_index INTEGER,
  task_id TEXT,
  target_id TEXT,
  menu_id TEXT,
  state_label TEXT,
  condition TEXT,
  practice INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 0,
  completion_time_ms REAL,
  elapsed_ms REAL,
  clicks INTEGER NOT NULL DEFAULT 0,
  wrong_department INTEGER NOT NULL DEFAULT 0,
  wrong_subcategory INTEGER NOT NULL DEFAULT 0,
  wrong_leaf INTEGER NOT NULL DEFAULT 0,
  backtracks INTEGER NOT NULL DEFAULT 0,
  category_switches INTEGER NOT NULL DEFAULT 0,
  path_efficiency REAL,
  first_click_ok INTEGER,
  first_click_element_id TEXT,
  search_attempts INTEGER NOT NULL DEFAULT 0,
  timed_out INTEGER NOT NULL DEFAULT 0,
  gave_up INTEGER NOT NULL DEFAULT 0,
  trial_end_count INTEGER NOT NULL DEFAULT 0,
  missing_trial_start INTEGER NOT NULL DEFAULT 0,
  missing_trial_end INTEGER NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  path_json TEXT NOT NULL DEFAULT '[]',
  scored_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trials_session ON trials(session_id);
CREATE INDEX IF NOT EXISTS idx_trials_menu ON trials(menu_id);
CREATE INDEX IF NOT EXISTS idx_trials_practice ON trials(practice);

CREATE TABLE IF NOT EXISTS questionnaires (
  response_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  block_id TEXT,
  menu_id TEXT,
  instrument TEXT NOT NULL,
  item_id TEXT NOT NULL,
  value REAL,
  text_value TEXT,
  answered_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_questionnaires_unique
  ON questionnaires(session_id, instrument, item_id, COALESCE(menu_id, ''), COALESCE(block_id, ''));
CREATE INDEX IF NOT EXISTS idx_questionnaires_session ON questionnaires(session_id);

CREATE TABLE IF NOT EXISTS researcher_notes (
  note_id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Gaze is deliberately separate from events/trials/questionnaires. It has its
-- own consent record, token hash, sample table and restricted export directory.
CREATE TABLE IF NOT EXISTS gaze_sessions (
  session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  camera_used INTEGER NOT NULL,
  synthetic INTEGER NOT NULL DEFAULT 0,
  token_hash TEXT NOT NULL,
  viewport_json TEXT NOT NULL,
  geometry_json TEXT NOT NULL,
  source_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'consented',
  last_seq INTEGER NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  calibration_json TEXT,
  quality_json TEXT,
  metrics_json TEXT,
  manifest_json TEXT,
  quality_overall TEXT,
  analysis_ready INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS gaze_batches (
  session_id TEXT NOT NULL REFERENCES gaze_sessions(session_id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  first_seq INTEGER NOT NULL,
  last_seq INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (session_id, batch_id)
);

CREATE TABLE IF NOT EXISTS gaze_samples (
  session_id TEXT NOT NULL REFERENCES gaze_sessions(session_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  t_ms REAL NOT NULL,
  t_source_ms REAL,
  x_px REAL,
  y_px REAL,
  valid INTEGER NOT NULL,
  invalid_reason TEXT,
  pupil_left_mm REAL,
  pupil_right_mm REAL,
  trial_id TEXT,
  PRIMARY KEY (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_gaze_samples_session_time ON gaze_samples(session_id, t_ms);
CREATE INDEX IF NOT EXISTS idx_gaze_batches_session ON gaze_batches(session_id);
`;
