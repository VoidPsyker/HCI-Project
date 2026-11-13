import { useRef, useState } from "react";
import { MENU_IDS, type MenuId } from "@meridian/taxonomy";
import { MENU_NAMES } from "../components/MenuChrome";
import type { EventLogger } from "../logger";
import { CREDIBILITY_ITEMS, MENU_PREFERENCE, NASA_ITEMS, OPEN_QUESTIONS, SUS_ITEMS } from "../content";

const TABS = [
  { id: "sus", label: "Menu usability", kind: "sus" as const },
  { id: "nasa", label: "Workload", kind: "nasa" as const, menu: null },
  { id: "open", label: "Open questions", kind: "open" as const, menu: null },
  { id: "credibility", label: "Credibility", kind: "credibility" as const, menu: null }
];

function menuGlimpse(menu: MenuId): string {
  return `/assets/menus/menu-${menu.toLowerCase()}.jpg`;
}

function Likert5({ value, onChange, label }: { value: number | undefined; onChange: (value: number) => void; label: string }) {
  return (
    <div className="likert" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((number) => (
        <button
          key={number}
          type="button"
          role="radio"
          aria-checked={value === number}
          className={value === number ? "likert-button selected" : "likert-button"}
          onClick={() => onChange(number)}
        >
          {number}
        </button>
      ))}
    </div>
  );
}

export function QuestionnairesScreen({
  sessionId,
  usabilityMenu,
  logger,
  fastMode,
  busy,
  onSubmit
}: {
  sessionId: string;
  usabilityMenu: MenuId;
  logger: EventLogger;
  fastMode: boolean;
  busy: boolean;
  onSubmit: (responses: Array<Record<string, unknown>>) => Promise<void>;
}) {
  const [tab, setTab] = useState(0);
  const [preferredMenu, setPreferredMenu] = useState("");
  const [sus, setSus] = useState<Record<number, number>>({});
  const [nasa, setNasa] = useState<Record<string, number>>({});
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<Record<string, string>>({});
  const [credibility, setCredibility] = useState<Record<string, number>>({});
  const current = TABS[tab]!;
  const answeredSus = SUS_ITEMS.every((_, index) => typeof sus[index] === "number");
  const answeredCredibility = CREDIBILITY_ITEMS.every((item) => typeof credibility[item.id] === "number");
  const answeredNasa = NASA_ITEMS.every((item) => typeof nasa[item.id] === "number");
  const answeredCurrent = current.kind === "sus" ? answeredSus && preferredMenu !== ""
    : current.kind === "nasa" ? answeredNasa : current.kind === "credibility" ? answeredCredibility : true;

  const fillNeutral = () => {
    setPreferredMenu("none");
    setSus(Object.fromEntries(SUS_ITEMS.map((_, index) => [index, 3])));
    setNasa(Object.fromEntries(NASA_ITEMS.map((item) => [item.id, 50])));
    setOpen(Object.fromEntries(OPEN_QUESTIONS.map((item) => [item.id, "Test-mode answer."])));
    setCredibility(Object.fromEntries(CREDIBILITY_ITEMS.map((item) => [item.id, 4])));
    setTab(TABS.length - 1);
  };

  const buildResponses = () => {
    const now = new Date().toISOString();
    const responses: Array<Record<string, unknown>> = [{
      response_id: crypto.randomUUID(),
      session_id: sessionId,
      instrument: "PREFERENCE",
      item_id: MENU_PREFERENCE.id,
      text_value: preferredMenu,
      answered_at: now
    }];
    for (let index = 0; index < SUS_ITEMS.length; index++) {
      responses.push({
        response_id: crypto.randomUUID(),
        session_id: sessionId,
        menu_id: usabilityMenu,
        instrument: "SUS",
        item_id: `Q${index + 1}`,
        value: sus[index],
        text_value: null,
        answered_at: now
      });
    }
    for (const item of NASA_ITEMS) {
      responses.push({
        response_id: crypto.randomUUID(),
        session_id: sessionId,
        instrument: "NASA_TLX",
        item_id: item.id,
        value: nasa[item.id],
        text_value: null,
        answered_at: now
      });
    }
    for (const item of OPEN_QUESTIONS) {
      responses.push({
        response_id: crypto.randomUUID(),
        session_id: sessionId,
        instrument: "OPEN",
        item_id: item.id,
        value: null,
        text_value: open[item.id] ?? "",
        answered_at: now
      });
    }
    for (const item of CREDIBILITY_ITEMS) {
      responses.push({
        response_id: crypto.randomUUID(),
        session_id: sessionId,
        instrument: "CREDIBILITY",
        item_id: item.id,
        value: credibility[item.id],
        text_value: null,
        answered_at: now
      });
    }
    return responses;
  };

  const submit = () => {
    if (busy || submitting.current || !answeredSus || !answeredNasa || !answeredCredibility || preferredMenu === "") return;
    submitting.current = true;
    setSaving(true);
    setError(false);
    const responses = buildResponses();
    for (const instrument of ["PREFERENCE", "SUS", "NASA_TLX", "OPEN", "CREDIBILITY"] as const) {
      logger.log({
        event_type: "questionnaire",
        meta: { instrument, count: responses.filter((r) => r.instrument === instrument).length }
      });
    }
    void onSubmit(responses).catch(() => {
      setError(true);
    }).finally(() => {
      submitting.current = false;
      setSaving(false);
    });
  };

  return (
    <section className="questionnaire-layout" data-testid="questionnaire-screen">
      <div className="questionnaire-head">
        <div>
          <div className="eyebrow">Final questionnaires</div>
          <h1>Tell us about the menus</h1>
          <p>
            Rate the menu you used in the final search, then answer questions about the session.
          </p>
        </div>
        {fastMode ? (
          <button type="button" className="button secondary" onClick={fillNeutral} data-testid="fill-neutral">
            Fill neutral answers (test mode)
          </button>
        ) : null}
      </div>
      <nav className="q-tabs" aria-label="Questionnaire sections">
        {TABS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={index === tab ? "q-tab active" : "q-tab"}
            onClick={() => setTab(index)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="q-body">
        {current.kind === "sus" ? (
          <>
          <div className="sus-page" data-testid={`sus-${usabilityMenu}`}>
            <div className="rated-menu" data-testid="rated-menu">
              <img src={menuGlimpse(usabilityMenu)} alt={`The ${MENU_NAMES[usabilityMenu]} menu`} />
              <div>
                <div className="eyebrow">You are rating the menu from your last search</div>
                <h2>{MENU_NAMES[usabilityMenu]}</h2>
                <p>Every statement below is about this menu. 1 = strongly disagree, 5 = strongly agree.</p>
              </div>
            </div>
            {SUS_ITEMS.map((item, index) => (
              <div key={index} className="sus-row">
                <span className="sus-number">{index + 1}</span>
                <span className="sus-text">{item}</span>
                <Likert5
                  label={item}
                  value={sus[index]}
                  onChange={(value) => setSus((currentSus) => ({ ...currentSus, [index]: value }))}
                />
              </div>
            ))}
          </div>
          <section className="menu-choice">
            <h2 id="menu-choice-label">{MENU_PREFERENCE.label}</h2>
            <div className="menu-choice-grid" role="radiogroup" aria-labelledby="menu-choice-label">
              {[...MENU_IDS, "none" as const].map((menu) => (
                <button
                  key={menu}
                  type="button"
                  role="radio"
                  aria-checked={preferredMenu === menu}
                  className={preferredMenu === menu ? "menu-choice-card selected" : "menu-choice-card"}
                  onClick={() => setPreferredMenu(menu)}
                  data-testid={`preferred-menu-${menu}`}
                >
                  {menu === "none" ? null : <img src={menuGlimpse(menu)} alt="" />}
                  <span>{menu === "none" ? MENU_PREFERENCE.no_preference : MENU_NAMES[menu]}</span>
                </button>
              ))}
            </div>
          </section>
          </>
        ) : null}

        {current.kind === "nasa" ? (
          <div className="nasa-page" data-testid="nasa-page">
            <h2>Workload (NASA-TLX)</h2>
            <p className="nasa-intro">
              &ldquo;The task&rdquo; means the 24 searches as a whole. Move each slider: <strong>left is very low, right is very
              high</strong>. The success question is the other way round: <strong>left is perfect, right is failure</strong>.
            </p>
            {NASA_ITEMS.map((item) => (
              <div key={item.id} className="nasa-row">
                <span className="nasa-question">
                  <small>{item.label}</small>
                  {item.question}
                </span>
                <input
                  aria-label={item.label}
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={nasa[item.id] ?? 50}
                  onChange={(event) => setNasa((currentNasa) => ({ ...currentNasa, [item.id]: Number(event.target.value) }))}
                />
                <strong>{nasa[item.id] ?? "Not answered"}</strong>
                <span className="nasa-ends" aria-hidden="true">
                  <span>{item.low}</span>
                  <span>{item.high}</span>
                </span>
                {nasa[item.id] === undefined ? (
                  <button type="button" className="button secondary nasa-midpoint" onClick={() => setNasa((currentNasa) => ({ ...currentNasa, [item.id]: 50 }))}>
                    Answer the middle (50)
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {current.kind === "open" ? (
          <div className="open-page" data-testid="open-page">
            <h2>Open questions</h2>
            <p className="small-note">Optional. A sentence or two is plenty.</p>
            {OPEN_QUESTIONS.map((item) => (
              <label key={item.id} className="field">
                <span>{item.label}</span>
                <textarea
                  rows={3}
                  maxLength={4000}
                  value={open[item.id] ?? ""}
                  onChange={(event) => setOpen((currentOpen) => ({ ...currentOpen, [item.id]: event.target.value }))}
                />
              </label>
            ))}
          </div>
        ) : null}

        {current.kind === "credibility" ? (
          <div className="cred-page" data-testid="cred-page">
            <h2>Scenario credibility</h2>
            <p className="small-note">1 = strongly disagree, 7 = strongly agree.</p>
            {CREDIBILITY_ITEMS.map((item) => (
              <div key={item.id} className="cred-row">
                <span>{item.label}</span>
                <div className="likert seven" role="radiogroup" aria-label={item.label}>
                  {[1, 2, 3, 4, 5, 6, 7].map((number) => (
                    <button
                      key={number}
                      type="button"
                      role="radio"
                      aria-checked={credibility[item.id] === number}
                      className={credibility[item.id] === number ? "likert-button selected" : "likert-button"}
                      onClick={() => setCredibility((currentCred) => ({ ...currentCred, [item.id]: number }))}
                    >
                      {number}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {error ? <p role="alert">Your questionnaires could not be saved. Please try again.</p> : null}
      <div className="q-actions">
        <button type="button" className="button secondary" disabled={tab === 0} onClick={() => setTab((currentTab) => Math.max(0, currentTab - 1))}>
          ← Previous
        </button>
        <span className="small-note">
          Section {tab + 1} of {TABS.length} · Progress is saved only when you submit the full set.
        </span>
        {tab < TABS.length - 1 ? (
          <button
            type="button"
            className="button primary"
            disabled={!answeredCurrent}
            onClick={() => setTab((currentTab) => Math.min(TABS.length - 1, currentTab + 1))}
          >
            Next section →
          </button>
        ) : (
          <button type="button" className="button primary" onClick={submit} disabled={busy || saving || !answeredSus || !answeredNasa || !answeredCredibility || preferredMenu === ""} data-testid="submit-questionnaires">
            {busy ? "Submitting…" : "Submit questionnaires"}
          </button>
        )}
      </div>
    </section>
  );
}
