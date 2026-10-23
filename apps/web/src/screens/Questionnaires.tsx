import { useMemo, useState } from "react";
import { MENU_IDS, type MenuId } from "@meridian/taxonomy";
import type { EventLogger } from "../logger";
import { CREDIBILITY_ITEMS, NASA_ITEMS, OPEN_QUESTIONS, SUS_ITEMS } from "../content";

const MENU_TABS = MENU_IDS.map((menu) => ({ id: `sus-${menu}`, label: `SUS ${menu}`, kind: "sus" as const, menu }));
const TABS = [
  ...MENU_TABS,
  { id: "nasa", label: "NASA-TLX", kind: "nasa" as const, menu: null },
  { id: "open", label: "Open questions", kind: "open" as const, menu: null },
  { id: "credibility", label: "Credibility", kind: "credibility" as const, menu: null }
];

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
  logger,
  fastMode,
  busy,
  onSubmit
}: {
  sessionId: string;
  logger: EventLogger;
  fastMode: boolean;
  busy: boolean;
  onSubmit: (responses: Array<Record<string, unknown>>) => Promise<void>;
}) {
  const [tab, setTab] = useState(0);
  const [sus, setSus] = useState<Record<string, number>>({});
  const [nasa, setNasa] = useState<Record<string, number>>(() =>
    Object.fromEntries(NASA_ITEMS.map((item) => [item.id, 50]))
  );
  const [open, setOpen] = useState<Record<string, string>>({});
  const [credibility, setCredibility] = useState<Record<string, number>>({});
  const current = TABS[tab]!;
  const answeredCurrent = useMemo(() => {
    if (current.kind === "sus") {
      return SUS_ITEMS.every((_, index) => typeof sus[`${current.menu}:${index}`] === "number");
    }
    if (current.kind === "credibility") {
      return CREDIBILITY_ITEMS.every((item) => typeof credibility[item.id] === "number");
    }
    return true;
  }, [credibility, current, sus]);

  const fillNeutral = () => {
    const nextSus: Record<string, number> = {};
    for (const menu of MENU_IDS) for (let index = 0; index < SUS_ITEMS.length; index++) nextSus[`${menu}:${index}`] = 3;
    setSus(nextSus);
    setNasa(Object.fromEntries(NASA_ITEMS.map((item) => [item.id, 50])));
    setOpen({
      strategy: "I scanned the main departments first and then narrowed down.",
      frustration: "The denser menu felt slower to scan.",
      suggestions: "Keep the category labels visible and consistent."
    });
    setCredibility(Object.fromEntries(CREDIBILITY_ITEMS.map((item) => [item.id, 4])));
    setTab(TABS.length - 1);
  };

  const buildResponses = () => {
    const now = new Date().toISOString();
    const responses: Array<Record<string, unknown>> = [];
    for (const menu of MENU_IDS) {
      for (let index = 0; index < SUS_ITEMS.length; index++) {
        responses.push({
          response_id: crypto.randomUUID(),
          session_id: sessionId,
          menu_id: menu,
          instrument: "SUS",
          item_id: `Q${index + 1}`,
          value: sus[`${menu}:${index}`] ?? 3,
          text_value: null,
          answered_at: now
        });
      }
    }
    for (const item of NASA_ITEMS) {
      responses.push({
        response_id: crypto.randomUUID(),
        session_id: sessionId,
        instrument: "NASA_TLX",
        item_id: item.id,
        value: nasa[item.id] ?? 50,
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
        value: credibility[item.id] ?? 4,
        text_value: null,
        answered_at: now
      });
    }
    return responses;
  };

  const submit = () => {
    const responses = buildResponses();
    for (const instrument of ["SUS", "NASA_TLX", "OPEN", "CREDIBILITY"] as const) {
      logger.log({
        event_type: "questionnaire",
        meta: { instrument, count: responses.filter((r) => r.instrument === instrument).length }
      });
    }
    void onSubmit(responses);
  };

  return (
    <section className="questionnaire-layout" data-testid="questionnaire-screen">
      <div className="questionnaire-head">
        <div>
          <div className="eyebrow">Final questionnaires</div>
          <h1>Tell us about the menus</h1>
          <p>
            Six short usability scales, one workload scale, three open questions, and four credibility items. There are
            no right answers. Your first impression is the useful one.
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
            {index < 6 ? (
              <>
                <span className={`q-menu-dot q-menu-${MENU_IDS[index]}`} aria-hidden="true" />
                {item.label}
              </>
            ) : (
              item.label
            )}
          </button>
        ))}
      </nav>
      <div className="q-body">
        {current.kind === "sus" ? (
          <div className="sus-page" data-testid={`sus-${current.menu}`}>
            <h2>Menu {current.menu} · System Usability Scale</h2>
            <p className="small-note">1 = strongly disagree, 5 = strongly agree.</p>
            {SUS_ITEMS.map((item, index) => (
              <div key={index} className="sus-row">
                <span className="sus-number">{index + 1}</span>
                <span className="sus-text">{item}</span>
                <Likert5
                  label={item}
                  value={sus[`${current.menu}:${index}`]}
                  onChange={(value) => setSus((currentSus) => ({ ...currentSus, [`${current.menu}:${index}`]: value }))}
                />
              </div>
            ))}
          </div>
        ) : null}

        {current.kind === "nasa" ? (
          <div className="nasa-page" data-testid="nasa-page">
            <h2>NASA-TLX</h2>
            <p className="small-note">Move each slider from low to high. 0 = low, 100 = high.</p>
            {NASA_ITEMS.map((item) => (
              <label key={item.id} className="nasa-row">
                <span>{item.label}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={nasa[item.id] ?? 50}
                  onChange={(event) => setNasa((currentNasa) => ({ ...currentNasa, [item.id]: Number(event.target.value) }))}
                />
                <strong>{nasa[item.id] ?? 50}</strong>
                <small>
                  {item.low} — {item.high}
                </small>
              </label>
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
          <button type="button" className="button primary" onClick={submit} disabled={busy || !answeredCurrent} data-testid="submit-questionnaires">
            {busy ? "Submitting…" : "Submit questionnaires"}
          </button>
        )}
      </div>
    </section>
  );
}
