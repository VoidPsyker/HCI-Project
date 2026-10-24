import { useState } from "react";
import { DEMOGRAPHICS } from "../content";

const LABELS: Record<string, string> = {
  "18-24": "18–24",
  "25-34": "25–34",
  "35-44": "35–44",
  "45-54": "45–54",
  "55-64": "55–64",
  "65+": "65+",
  woman: "Woman",
  man: "Man",
  "non-binary": "Non-binary",
  "prefer not to say": "Prefer not to say",
  "self-describe": "Self-describe",
  secondary: "Secondary school",
  vocational: "Vocational / apprenticeship",
  undergraduate: "Undergraduate degree",
  postgraduate: "Postgraduate degree",
  doctorate: "Doctorate",
  never: "Never",
  rarely: "Rarely",
  monthly: "Monthly",
  weekly: "Weekly",
  daily: "Daily",
  typical: "Typical colour vision",
  corrected: "Corrected (glasses / lenses)",
  atypical: "Atypical / colour vision difference"
};

export function DemographicsScreen({
  onSubmit,
  busy
}: {
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [form, setForm] = useState({
    age_band: "",
    gender: "",
    gender_self_describe: "",
    education: "",
    shopping_freq: "",
    watch_expertise: 4,
    tech_savvy: 4,
    colour_vision: ""
  });
  const set = (key: keyof typeof form, value: string | number) => setForm((current) => ({ ...current, [key]: value }));
  const complete = Boolean(
    form.age_band &&
      form.gender &&
      form.education &&
      form.shopping_freq &&
      form.colour_vision &&
      (form.gender !== "self-describe" || form.gender_self_describe.trim())
  );

  return (
    <section className="panel medium" data-testid="demographics-screen">
      <div className="eyebrow">About you</div>
      <h1>Demographics</h1>
      <p className="lede">
        These details let us describe the pilot sample and balance the menu sequences. They are stored with a
        pseudonymous code, not your name.
      </p>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          if (!complete) return;
          void onSubmit(form);
        }}
      >
        <label className="field">
          <span>Age band</span>
          <select value={form.age_band} onChange={(event) => set("age_band", event.target.value)} required>
            <option value="">Select…</option>
            {DEMOGRAPHICS.age_band.map((value) => (
              <option key={value} value={value}>
                {LABELS[value] ?? value}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Gender</span>
          <select value={form.gender} onChange={(event) => set("gender", event.target.value)} required>
            <option value="">Select…</option>
            {DEMOGRAPHICS.gender.map((value) => (
              <option key={value} value={value}>
                {LABELS[value] ?? value}
              </option>
            ))}
          </select>
        </label>
        {form.gender === "self-describe" ? (
          <label className="field span-2">
            <span>How would you describe your gender?</span>
            <input
              type="text"
              maxLength={80}
              value={form.gender_self_describe}
              onChange={(event) => set("gender_self_describe", event.target.value)}
              required
            />
          </label>
        ) : null}
        <label className="field">
          <span>Highest education</span>
          <select value={form.education} onChange={(event) => set("education", event.target.value)} required>
            <option value="">Select…</option>
            {DEMOGRAPHICS.education.map((value) => (
              <option key={value} value={value}>
                {LABELS[value] ?? value}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Watch shopping frequency</span>
          <select value={form.shopping_freq} onChange={(event) => set("shopping_freq", event.target.value)} required>
            <option value="">Select…</option>
            {DEMOGRAPHICS.shopping_freq.map((value) => (
              <option key={value} value={value}>
                {LABELS[value] ?? value}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Colour vision</span>
          <select value={form.colour_vision} onChange={(event) => set("colour_vision", event.target.value)} required>
            <option value="">Select…</option>
            {DEMOGRAPHICS.colour_vision.map((value) => (
              <option key={value} value={value}>
                {LABELS[value] ?? value}
              </option>
            ))}
          </select>
        </label>
        <label className="field range-field">
          <span>
            Watch expertise <strong>{form.watch_expertise}/7</strong>
          </span>
          <input
            type="range"
            min={1}
            max={7}
            step={1}
            value={form.watch_expertise}
            onChange={(event) => set("watch_expertise", Number(event.target.value))}
          />
          <small>1 = novice, 7 = expert</small>
        </label>
        <label className="field range-field">
          <span>
            Technology comfort <strong>{form.tech_savvy}/7</strong>
          </span>
          <input
            type="range"
            min={1}
            max={7}
            step={1}
            value={form.tech_savvy}
            onChange={(event) => set("tech_savvy", Number(event.target.value))}
          />
          <small>1 = not confident, 7 = very confident</small>
        </label>
        <div className="panel-actions span-2">
          <span className="small-note">No name, email, or IP address is collected. Gaze data are stored separately from these answers.</span>
          <button type="submit" className="button primary" disabled={!complete || busy} data-testid="demographics-continue">
            {busy ? "Assigning sequence…" : "Continue to baseline"}
          </button>
        </div>
      </form>
    </section>
  );
}
