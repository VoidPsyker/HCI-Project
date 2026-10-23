# PROMPT: Build the functional pilot instrument for "Emotion-Contingent Navigation"

You are a senior full-stack engineer building a research instrument. Your source of truth is the plan you wrote: **Emotion-Contingent Navigation — Experimental Plan v1.0 (23 Oct 2026)**. Re-read these sections of it before writing any code: **§3 (emotional contexts), §4 (six menus + parity contract), §5 (store, tasks, event schema, architecture, acceptance criteria), §7 (pilot), §11 (instruments), §14 (implementation plan), §15 (ethics)**. Where this prompt and the plan disagree, the plan wins, and you log the disagreement in `ASSUMPTIONS.md`.

Do **not** ask me questions. Make reasonable decisions, record them in `ASSUMPTIONS.md`, and deliver a complete, runnable result in one pass.

---

## 1. Goal and scope

Build a **working pilot** of the fictional watch store **Meridian Timepieces** that a researcher can run on a lab machine today with N = 8–10 pilot participants (plan §7). It is a controlled instrument, **not** a production e-commerce site (no cart, checkout, accounts, payments).

**In scope (pilot):**
- All six menus (A–F) over one shared taxonomy and 72 products
- Four emotion inductions + check-ins + neutral resets
- Practice trials, 12 main trials, timing, scoring, event logging
- Consent, demographics, questionnaires, debrief
- Server-side seeded randomisation with an audit table
- Researcher/admin dashboard: monitor, QA report, pilot go/no-go criteria, exports
- Automated tests for the acceptance criteria in plan §5.7

**Out of scope for the pilot** (stub only, behind a disabled feature flag, with a clear TODO): Study 2 conditions (matched/mismatched/sham), Study 3 estimator and adaptation engine (§10, §14.4). Keep the event schema and `condition` field ready for them.

**Hard rules from the plan:**
- No webcam, facial analysis, or biometrics. Emotion = self-report anchor; behaviour is logged only as noisy features.
- No external network requests during a trial (no CDNs, fonts, analytics, remote images/video). Bundle everything locally.
- The participant client never chooses its own condition. The server assigns it.
- A visible "Stop / I'd like to pause" control is available at all times; distress > 6/10 on any check-in stops the induction and triggers immediate debrief (§3.4, §15.3).

---

## 2. Tech stack (per plan §5.5)

- **Front end:** React 18 + TypeScript + Vite, Zustand for session state, Tailwind or CSS modules. Menus A/B/C with Radix UI primitives (restyled); **D and F with D3 + SVG**; **E with CSS Grid + Framer Motion**.
- **Back end:** Node + Fastify (or Express) + Zod validation.
- **Database:** PostgreSQL via Docker Compose **if** available; otherwise default to **SQLite** (better-sqlite3) behind a small repository interface so Postgres can be swapped in. Tables: `participants, sessions, trials, events, questionnaires, assignments_audit`. Event metadata in JSON/JSONB. **Also append every raw event to a `data/raw/<session_id>.jsonl` archive.**
- **Experiment runner:** custom React timeline inspired by jsPsych; `performance.now()` for all within-trial timing; server receipt timestamp on every event.
- **Monorepo layout:**
  ```
  /apps/web      (React runner + six menu renderers)
  /apps/server   (API, randomisation, ingestion, export, admin)
  /packages/taxonomy   (taxonomy.json, products.json, tasks.json, validateTaxonomy(), types)
  /packages/analysis   (R + Python export-reading skeleton, see §10 below)
  /tests  /docs  ASSUMPTIONS.md  README.md
  ```
- One command to run everything: `npm install && npm run dev` (document it in README, including Docker option). Provide `npm run seed`, `npm test`, `npm run test:e2e`, `npm run export`.

---

## 3. Shared taxonomy and products (single source of truth)

`packages/taxonomy/taxonomy.json` is the **only** place labels live. Every menu reads it. Exactly **4 departments → 3 subcategories each → 6 leaf styles each = 72 products**:

| Department (L1) | Subcategory (L2) | Leaf styles (L3) |
|---|---|---|
| Sport & Dive | Pro Diver 300m | Titanium Deep, Steel Blue, Carbon Black, Ocean Green, Bronze Reef, Midnight Lume |
| | Aqua Racer Chrono | Regatta White, Gulf Blue, Carbon Track, Sunset Orange, Steel Grey, Night Dash |
| | Trail Master GMT | Alpine Sand, Forest Green, Granite Grey, Summit Blue, Ember Red, Midnight Trail |
| Dress & Formal | Heritage Classic | Ivory Dial, Rose Gold, Anthracite, Moon Silver, Bordeaux, Onyx |
| | Midnight Dress | Deep Navy, Black Tie, Sapphire, Graphite, Pearl White, Champagne |
| | Artisan Moonphase | Celestial Blue, Warm Silver, Slate Grey, Aurora, Copper Brown, Starlight |
| Everyday & Casual | Field Standard | Khaki Canvas, Olive, Stone, Sandstone, Charcoal, Navy Weave |
| | Urban Minimal | Matte White, Concrete Grey, Ink Black, Soft Beige, Steel Mesh, Deep Teal |
| | Weekender | Sunset Clay, Ocean Stripe, Cream, Moss, Denim, Rust |
| Smart & Hybrid | Smart One | Graphite, Silver, Rose, Midnight, Titanium, Forest |
| | Hybrid Active | Black Sport, Blue Sport, Green Sport, Orange Sport, White Sport, Grey Sport |
| | Connected Classic | Heritage Black, Heritage Brown, Steel Blue, Cream, Slate, Burgundy |

**Node schema** (plan §14.2): `{ id, label, level: 1|2|3, parentId, productId?, colour?, icon? }`. IDs are stable and hierarchical, e.g. `sport.prodiver.titanium`.

**Product attributes** (each leaf gets a **unique attribute vector**): case size {38,40,42,44} mm; strap {steel, titanium, leather, rubber, mesh, fabric}; movement {automatic, quartz, solar, hybrid}; water resistance {50,100,200,300} m; dial colour {blue, black, green, white, grey, brown, silver, champagne, orange}; price band {£180–£240, £240–£420, £420–£900, £900+}. Assign vectors so they are **plausible for the leaf name** and so the 12 example tasks in plan Table 5.1 (T01–T12) resolve to exactly the leaves listed there. Generate a fictional price inside the band for each product.

**Product content:** one shared product card and one shared product detail page used after any leaf selection in every menu. Generate **parametric inline SVG watch illustrations** (dial colour, strap, case size) so there are no image files or external requests. All names/prices fictional; no real brands.

**`validateTaxonomy()`** must assert: 4 L1; 3 L2 per L1; 6 L3 per L2; unique IDs; no orphans; unique product attribute vectors; every task description maps to **exactly one** product (reject and regenerate otherwise). The **build must fail** if this fails (wire it into `npm run build` and CI).

---

## 4. The six menus (plan §4.2; implement the `MenuRenderer` contract from §14.2)

All six share one event vocabulary and the props `{menuId, nodes, visibleLevel, onOpen, onSelect, onBack, log, disabled}`. Every transition is **180–220 ms ease-in-out** and honours `prefers-reduced-motion`. No decorative motion. Every interactive element is **≥ 44 × 44 px with ≥ 8 px spacing** at 1920 × 1080.

- **A · Horizontal bar.** Top bar of 4 departments + (disabled) Search. Click 1 opens the L2 dropdown; click 2 opens the L3 side flyout; click 3 selects the leaf. One L2 set and one L3 set visible at a time; flyout closes on outside click. **3 clicks.**
- **B · Vertical sidebar.** Persistent left tree, nested accordion. Click 1 expands department, click 2 expands subcategory, click 3 selects leaf. Content area always visible. **3 clicks.**
- **C · Mega menu.** Click 1 opens one panel showing all 3 subcategories as 3 columns × 6 leaves (18 leaves visible). Click 2 selects leaf. **2 clicks** (intentional; do not add a fake click). Visible breadth 4 → 18.
- **D · Fractal / recursive tiles.** Recursive 2 × 2 tile layout; clicking a tile zooms the viewport so its children fill the same geometric layout; click outside the tile or use the breadcrumb to zoom out. Use `d3-zoom` / `d3-hierarchy`. Breadcrumb always present. **3 clicks.** Layout must recur identically at each level (4 → 3 → 6).
- **E · Rounded-square icon grid.** Large colour-coded rounded-square cards with icon + label + category colour (type is not the only cue). Level 1: 4 cards, level 2: 3 cards, level 3: 6 cards. Compact breadcrumb. **3 clicks.**
- **F · Radial lattice.** Four fixed compass sectors around a central **HUB (back)**. Selecting a department projects its 3 L2 anchors onto an inner ring and its 6 L3 leaves onto the outer ring. Build with D3 arcs; ring nodes must meet the 44 px hit-target minimum. Breadcrumb present. **3 clicks.**

**Parity contract (plan Table 4.2), enforced in code:**
- Same typography, spacing scale, and the **4-colour department palette** across all menus (white background, slate text, teal accent). Colour-to-department mapping is **counterbalanced across participants** (server-assigned, logged).
- Same icon set per department/subcategory (small in A–D/F, large in E).
- **Search** is visibly present in every menu but disabled with the message "Search is unavailable in this session." Clicks on it are logged as `search_attempt`.
- **Breadcrumb:** always in D, F; in A/B/C only after a department is selected; compact in E.
- **Back:** an in-page Back control plus browser back; both logged; no destructive navigation.
- **No artificial delays;** all content preloaded; target ≥ 50 fps (60 fps goal).
- Fixed **1920 × 1080 stage**. Log actual viewport and device pixel ratio. If the viewport differs, show a researcher-visible warning (not a participant-visible one).
- Log `visible_options` (number of visible options) at every step in event `meta`.

---

## 5. Task bank and trial scoring (plan §5.2–5.3)

- Known-item finding: a natural-language goal describing **2–3 attributes** (never the product name). Build the **full bank of 72 targets** (one per product) with wording generated from attribute vectors, plus the 12 canonical tasks T01–T12 exactly as in plan Table 5.1. Tag each with difficulty **easy / medium / hard** per the three properties in §5.2 (serial position, semantic distance from the leaf label, number of same-colour/material distractors). Document your difficulty rule in `docs/difficulty.md` and compute it, don't hand-wave it.
- Trial flow: show instruction → participant presses "Start" → **instruction disappears = task onset** → menu active → success when the **correct product ID** detail page renders.
- **Timeout 120 s**, plus an "I can't find it" button; both are failures, with the reason logged.
- Automated scoring from the event log only: success; completion time; wrong department; wrong subcategory; wrong leaf; backtrack; category switch; path efficiency (min clicks ÷ actual, min = 2 for C and 3 for others, capped at 1); first-click correctness; search attempts; timeout/give-up. Use the exact definitions in plan §5.3.
- Unit tests with **100% coverage of scoring code**.

---

## 6. Emotion inductions, check-ins, and the pilot session flow (plan §3, §7)

**Inductions** are mild, short, reversible, and placed **before a block of 3 trials**, never during a trial. Order of the four blocks is counterbalanced with a **4 × 4 Latin square** (server-assigned). A **60-s neutral reset** (local nature clip or a calm filler task; use an included placeholder asset and a config path so the researcher can drop in the real file) separates blocks. Every induction page: states the cover story, has the Stop control, and ends with a check-in.

| State | Induction (≤ 2.5 min) | Notes / stop rule |
|---|---|---|
| Happy | ~90-s amusing clip from a **local configurable file** (placeholder + clear README note that a validated clip must be supplied) + a positive "you found a great deal" scenario | Stop if distress > 6/10 |
| Frustrated | ~90-s **"buggy search"** task: valid queries return "No results", the filter resets, neutral message. **Cap at 3 attempts**; no personal-failure feedback | Immediate debrief after the block |
| Confused | ~90-s **ambiguous categorisation**: place a product into one of four overlapping categories with no definitions or feedback | Debrief that ambiguity was deliberate |
| Bored | ~90-s **repetitive catalogue task**: verify the price of 30 identical watch straps, one by one, no variation | Allow early exit; log it |

**Check-in (after each induction and after each trial block):** 9-point SAM valence and arousal, four 7-point items (happy, frustrated, confused, bored), and a 0–10 distress item. **State label rule (§3.3):** label = the discrete item that is highest **and** ≥ 5; if the highest is < 5 or tied → `mixed`. Compute and store `state_label` plus a `manipulation_check_passed` flag per the thresholds in the plan's induction table (e.g. happy: SAM valence ≥ 6, happy ≥ 5, arousal 4–7; frustrated: item ≥ 5, valence ≤ 4).

**Session timeline (must total ≤ 100 min, §7.3):**
1. Consent → demographics (include colour-vision screen, prior experience with menu types, shopping frequency) → baseline affect
2. Think-aloud instructions + demo
3. **Practice walkthrough:** one practice task per menu, A–F, in seeded order; experimenter-visible note field for confusion (no help unless stuck 60 s — surface a "stuck 60 s" flag on the admin dashboard)
4. **Four blocks:** induction → check-in → **3 trials** → check-in → fatigue rating → neutral reset. Total **12 main trials**; the menu for each trial comes from a seeded balanced rotation so **each menu appears exactly twice** per participant and no menu repeats within a block.
5. Questionnaires: **SUS per menu**, **NASA-TLX**, open-ended items (what was confusing / fast / frustrating) and a credibility probe for each induction
6. Debrief (explain the purpose, that inductions were mild and for study of the interface, not the person) and a withdrawal option that deletes the session on request

All instruction text, scripts, and items live in editable JSON/Markdown under `/apps/web/content`, not hard-coded in components.

---

## 7. Event logging (plan §5.4), exactly

Every interaction is a JSON line with: `event_id (UUID, idempotent ingestion), participant_id (pseudonymous, no name/email/IP), session_id, study ("pilot"), block_id, trial_id, task_id, target_id, menu_id (A–F), state_label, condition ("static" for pilot), event_type, t_client (performance.now()), t_server (ISO), elapsed_ms, level (0–3), element_id, element_label, parent_id, x, y, input_type (mouse|trackpad|keyboard|touch), meta (JSON)`.

Event types: `session_start, consent, demographics, practice_start, block_start, induction_start, induction_end, checkin, trial_start, menu_open, menu_close, node_hover, node_click, leaf_select, product_view, back, search_attempt, timeout, give_up, trial_end, block_end, adaptation_shown, adaptation_accepted, adaptation_reverted, questionnaire, session_end`.

Client buffers events **every 500 ms**, flushes on unload (`sendBeacon`), keeps an **offline queue**, and the server ingests idempotently by `event_id` and validates with Zod. Every trial must end with exactly one `trial_end`.

---

## 8. Randomisation service (plan §14.3)

Server-side only. `generateBalancedDesign({ blockOrders: latinSquare(4), menuOrders: latinSquare(6), targetSets: 6, seed })`. Assign the next unused sequence in a stratum (gender, shopping frequency), write to `assignments_audit` with **sequence ID, block order, menu orders, target set, colour mapping, and a hash of the seed**. Same seed → identical assignments. If a stratum is exhausted, generate a new block rather than reusing. Include `npm run audit:balance` producing a chi-square balance report.

---

## 9. Researcher / admin interface (`/admin`, password from env var)

- Create participants and sessions, view the assigned sequence, start/resume a session
- Live session monitor (current phase, menu, trial, elapsed, "stuck 60 s", distress flags, a one-click **Abort & debrief**)
- **Pilot go/no-go dashboard** computing the criteria in plan §7.1 from collected data: per-menu practice success ≥ 80%; induction dominant-state ≥ 60% and mean intensity ≥ 5/7; no distress > 6/10; induction ≤ 2.5 min; overall success 75–90% with easy > medium > hard; session ≤ 100 min; trial median ≤ 45 s; < 5% missing questionnaire data; 100% of practice trials reconstructable; ≥ 50 fps
- **Technical QA report:** missing events, missing `trial_end`, duplicate IDs, clock skew, console errors, frame-rate samples (log `requestAnimationFrame` frame times during trials)
- **Task calibration table:** success and median time by task and by menu
- Exports: versioned **CSV and JSONL** for events, trials (one row per trial with all scored outcomes), check-ins, and questionnaires, each with a checksum

---

## 10. Analysis scaffolding (small, not a full analysis)

In `/packages/analysis`: an R script and a Python script that read the export and produce (a) the pilot manipulation-check report per induction, (b) the task difficulty table, and (c) the variance-component starting values the plan asks the pilot to produce (participant intercept SD, residual SD, target SD, menu × state SD) using `lme4` on log time, with a clear note that pilot data are **excluded from confirmatory analysis**.

---

## 11. Accessibility and ethics hooks

- WCAG 2.2 AA where feasible: keyboard operability for every menu (logged as `input_type: keyboard`), visible focus, 4.5:1 text contrast, 3:1 non-text contrast, ARIA roles, reduced-motion support. Do **not** claim full compliance.
- Consent screen text is a clearly marked **placeholder** pending ethics approval (plan status: ethics approval required before data collection). Show a banner in admin: "Pilot build, ethics approval required before real participants."
- Data minimisation: no names, emails, or IPs in the research dataset.

---

## 12. Acceptance criteria (gate to pilot, plan §5.7), all must pass automatically

1. Every one of the 72 products is reachable in **every** menu with the same number of semantic levels (**432 paths = 6 × 72**, Playwright nightly suite plus a **24-path smoke suite**).
2. Every target description maps to exactly one product (uniqueness test).
3. All six menus show identical labels and product data from the one JSON source (**label-parity test fails the build** on any missing or renamed node).
4. All interactive targets ≥ 44 × 44 px at 1920 × 1080, with no overlap or clipping (Playwright geometry assertions plus screenshots of each menu at each level).
5. Transitions measure 180–220 ms and stay ≥ 50 fps.
6. Event logs reconstruct the full path for **100%** of test trials; no missing `trial_end`.
7. Randomisation is reproducible from a seed and audited server-side.
8. No console errors and **no external network requests during a trial** (assert in Playwright by blocking all non-localhost requests).

Also add: Zod/JSON-Schema ingestion tests, duplicate-event-ID test, `performance.now()` monotonicity test, axe-core checks, and a keyboard-only walkthrough for each menu.

---

## 13. Deliverables and working order

Work in this order, and **run the tests after each stage**:
1. Taxonomy + products + task bank + `validateTaxonomy()` (+ tests)
2. Shared renderer contract, event logger, and menus A, B, C
3. Menus D, E, F
4. Server: ingestion, DB, randomisation, audit, exports
5. Experiment runner: consent → demographics → practice → inductions → check-ins → trials → questionnaires → debrief
6. Admin dashboard, QA report, go/no-go criteria
7. Playwright suites, accessibility, timing/fps checks
8. README, `ASSUMPTIONS.md`, `docs/difficulty.md`, `docs/researcher-guide.md` (how to run a pilot session, how to swap in the validated video clip, how to export)

At the end, run the full test suite and a **simulated full session end-to-end** (scripted participant) and show me: the passing test summary, an exported trials CSV sample, the acceptance-criteria checklist with pass/fail for each item, and the exact commands to start the app. List anything you could not complete or had to assume.
