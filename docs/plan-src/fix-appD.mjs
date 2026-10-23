import fs from "node:fs";

const p = "D:/hci project iat/docs/plan-src/13-references-appendix.html";
let t = fs.readFileSync(p, "utf8");

const start = t.indexOf('  <h2 id="appD">');
const end = t.indexOf('  <h2 id="appE">');
if (start < 0 || end < 0 || end <= start) throw new Error("markers not found");

const block = `  <h2 id="appD">Appendix D — Data schema (SQL DDL, simplified)</h2>

  <p class="small muted">The DDL is split into five blocks so that it paginates cleanly. It is illustrative; the migration files in the repository are the source of truth.</p>

  <h3>D.1 Participants and sessions</h3>
  <pre><span class="k">CREATE TABLE</span> participants (
  participant_id   text <span class="k">PRIMARY KEY</span>,
  created_at       timestamptz <span class="k">NOT NULL DEFAULT</span> now(),
  age_band         text,
  gender           text,
  education        text,
  shopping_freq    text,
  watch_expertise  smallint,
  tech_savvy       smallint,
  colour_vision    text,
  consent_version  text <span class="k">NOT NULL</span>
);

<span class="k">CREATE TABLE</span> sessions (
  session_id       uuid <span class="k">PRIMARY KEY</span>,
  participant_id   text <span class="k">REFERENCES</span> participants,
  study            text <span class="k">NOT NULL</span>,          <span class="c">-- pilot | s1 | s2 | s3</span>
  sequence_id      text <span class="k">NOT NULL</span>,
  taxonomy_hash    text <span class="k">NOT NULL</span>,
  started_at       timestamptz <span class="k">NOT NULL</span>,
  ended_at         timestamptz,
  input_type       text,
  browser          text,
  viewport         text
);</pre>

  <h3>D.2 Trials</h3>
  <pre><span class="k">CREATE TABLE</span> trials (
  trial_id         uuid <span class="k">PRIMARY KEY</span>,
  session_id       uuid <span class="k">REFERENCES</span> sessions,
  block_id         text <span class="k">NOT NULL</span>,
  trial_index      smallint <span class="k">NOT NULL</span>,
  task_id          text <span class="k">NOT NULL</span>,
  target_id        text <span class="k">NOT NULL</span>,
  menu_id          text <span class="k">NOT NULL</span>,
  state_label      text <span class="k">NOT NULL</span>,
  condition        text,
  success          boolean,
  time_ms          integer,
  clicks           smallint,
  errors           smallint,
  backtracks       smallint,
  category_switches smallint,
  path_efficiency  numeric(5,3),
  first_click_ok   boolean,
  search_attempts  smallint,
  timed_out        boolean,
  gave_up          boolean
);</pre>

  <h3>D.3 Events</h3>
  <pre><span class="k">CREATE TABLE</span> events (
  event_id         uuid <span class="k">PRIMARY KEY</span>,
  session_id       uuid <span class="k">REFERENCES</span> sessions,
  trial_id         uuid <span class="k">REFERENCES</span> trials,
  event_type       text <span class="k">NOT NULL</span>,
  t_client         double precision <span class="k">NOT NULL</span>,
  t_server         timestamptz <span class="k">NOT NULL DEFAULT</span> now(),
  elapsed_ms       integer,
  level            smallint,
  element_id       text,
  element_label    text,
  parent_id        text,
  x                integer,
  y                integer,
  meta             jsonb <span class="k">NOT NULL DEFAULT</span> <span class="s">'{}'</span>::jsonb
);</pre>

  <h3>D.4 Questionnaires and randomisation audit</h3>
  <pre><span class="k">CREATE TABLE</span> questionnaires (
  response_id      uuid <span class="k">PRIMARY KEY</span>,
  session_id       uuid <span class="k">REFERENCES</span> sessions,
  block_id         text,
  menu_id          text,
  instrument       text <span class="k">NOT NULL</span>,
  item_id          text <span class="k">NOT NULL</span>,
  value            numeric,
  text_value       text,
  answered_at      timestamptz <span class="k">NOT NULL DEFAULT</span> now()
);

<span class="k">CREATE TABLE</span> randomisation_audit (
  participant_id   text <span class="k">PRIMARY KEY</span>,
  sequence_id      text <span class="k">NOT NULL</span>,
  block_order      text <span class="k">NOT NULL</span>,
  menu_orders      jsonb <span class="k">NOT NULL</span>,
  target_set       smallint <span class="k">NOT NULL</span>,
  seed_hash        text <span class="k">NOT NULL</span>,
  assigned_at      timestamptz <span class="k">NOT NULL DEFAULT</span> now()
);</pre>

  <h3>D.5 Adaptation log and indexes</h3>
  <pre><span class="k">CREATE TABLE</span> adaptation_log (
  decision_id      uuid <span class="k">PRIMARY KEY</span>,
  session_id       uuid <span class="k">REFERENCES</span> sessions,
  trial_id         uuid <span class="k">REFERENCES</span> trials,
  predicted_state  text,
  confidence       numeric(4,3),
  current_menu     text,
  target_menu      text,
  decision         text <span class="k">NOT NULL</span>,   <span class="c">-- adapt | abstain | rejected | reverted</span>
  reason           text,
  created_at       timestamptz <span class="k">NOT NULL DEFAULT</span> now()
);

<span class="k">CREATE INDEX</span> idx_events_session <span class="k">ON</span> events(session_id, t_client);
<span class="k">CREATE INDEX</span> idx_trials_session <span class="k">ON</span> trials(session_id, block_id);</pre>

`;

t = t.slice(0, start) + block + t.slice(end);
fs.writeFileSync(p, t, "utf8");
console.log("Appendix D replaced; block chars:", block.length);
