import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const taxonomy = JSON.parse(fs.readFileSync(path.join(dir, "..", "taxonomy.json"), "utf8"));

const cases = [38, 40, 42, 44];
const straps = ["steel", "titanium", "leather", "rubber", "mesh", "fabric"];
const movements = ["automatic", "quartz", "solar", "hybrid"];
const waters = [50, 100, 200, 300];
const dials = ["blue", "black", "green", "white", "grey", "brown", "silver", "champagne", "orange"];
const bands = ["£180–£240", "£240–£420", "£420–£900", "£900+"];

const leaves = taxonomy.nodes.filter((n) => n.level === 3);
const departments = taxonomy.nodes.filter((n) => n.level === 1);
const subs = taxonomy.nodes.filter((n) => n.level === 2);
const byId = new Map(taxonomy.nodes.map((n) => [n.id, n]));
const deptIndex = new Map(departments.map((d, i) => [d.id, i]));
const subIndex = new Map(subs.map((s, i) => [s.id, i % 3]));
const attrNames = ["caseSize", "strap", "movement", "water", "dial", "priceBand"];

const canonical = {
  "sport.prodiver.steel-blue": {
    id: "T01", description: "Titanium dive watch, 300 m, deep blue dial", difficulty: "Easy",
    attributes: { caseSize: 42, strap: "titanium", movement: "automatic", water: 300, dial: "blue", priceBand: "£420–£900" }
  },
  "sport.prodiver.titanium-deep": {
    id: "T02", description: "Lightweight titanium dive watch, 300 m, black dial", difficulty: "Medium",
    attributes: { caseSize: 44, strap: "titanium", movement: "automatic", water: 300, dial: "black", priceBand: "£900+" }
  },
  "sport.trail.forest-green": {
    id: "T03", description: "42 mm automatic trail watch, green dial, fabric strap", difficulty: "Medium",
    attributes: { caseSize: 42, strap: "fabric", movement: "automatic", water: 200, dial: "green", priceBand: "£240–£420" }
  },
  "dress.heritage.ivory-dial": {
    id: "T04", description: "Rose-gold dress watch, ivory dial, leather strap", difficulty: "Easy",
    attributes: { caseSize: 38, strap: "leather", movement: "quartz", water: 50, dial: "white", priceBand: "£420–£900" }
  },
  "dress.midnight.deep-navy": {
    id: "T05", description: "Black-tie watch, deep navy dial, 40 mm", difficulty: "Medium",
    attributes: { caseSize: 40, strap: "leather", movement: "automatic", water: 50, dial: "blue", priceBand: "£240–£420" }
  },
  "dress.moonphase.celestial-blue": {
    id: "T06", description: "Moonphase complication, celestial blue dial", difficulty: "Hard",
    attributes: { caseSize: 42, strap: "leather", movement: "automatic", water: 50, dial: "blue", priceBand: "£900+" }
  },
  "everyday.field.khaki-canvas": {
    id: "T07", description: "38 mm field watch, khaki canvas strap, automatic", difficulty: "Easy",
    attributes: { caseSize: 38, strap: "fabric", movement: "automatic", water: 100, dial: "brown", priceBand: "£180–£240" }
  },
  "everyday.urban.matte-white": {
    id: "T08", description: "Minimalist watch, matte white dial, steel mesh strap", difficulty: "Medium",
    attributes: { caseSize: 40, strap: "mesh", movement: "quartz", water: 50, dial: "white", priceBand: "£240–£420" }
  },
  "everyday.weekender.sunset-clay": {
    id: "T09", description: "Weekend watch, sunset clay dial, rubber strap", difficulty: "Hard",
    attributes: { caseSize: 42, strap: "rubber", movement: "quartz", water: 100, dial: "orange", priceBand: "£180–£240" }
  },
  "smart.smartone.graphite": {
    id: "T10", description: "Graphite smartwatch, titanium case, 44 mm", difficulty: "Medium",
    attributes: { caseSize: 44, strap: "titanium", movement: "hybrid", water: 50, dial: "grey", priceBand: "£420–£900" }
  },
  "smart.hybridactive.orange-sport": {
    id: "T11", description: "Hybrid sport watch, orange accent, rubber strap", difficulty: "Hard",
    attributes: { caseSize: 44, strap: "rubber", movement: "hybrid", water: 100, dial: "orange", priceBand: "£240–£420" }
  },
  "smart.connected.burgundy": {
    id: "T12", description: "Connected classic, burgundy leather strap, 42 mm", difficulty: "Hard",
    attributes: { caseSize: 42, strap: "leather", movement: "hybrid", water: 50, dial: "brown", priceBand: "£420–£900" }
  }
};

const canonicalCriteria = {
  T01: { departmentId: "sport", subcategoryId: "sport.prodiver", strap: "titanium", water: 300, dial: "blue" },
  T02: { departmentId: "sport", subcategoryId: "sport.prodiver", strap: "titanium", water: 300, dial: "black" },
  T03: { departmentId: "sport", subcategoryId: "sport.trail", caseSize: 42, movement: "automatic", dial: "green", strap: "fabric" },
  T04: { departmentId: "dress", subcategoryId: "dress.heritage", dial: "white", strap: "leather" },
  T05: { departmentId: "dress", subcategoryId: "dress.midnight", dial: "blue", caseSize: 40 },
  T06: { departmentId: "dress", subcategoryId: "dress.moonphase", dial: "blue" },
  T07: { departmentId: "everyday", subcategoryId: "everyday.field", caseSize: 38, strap: "fabric", movement: "automatic" },
  T08: { departmentId: "everyday", subcategoryId: "everyday.urban", dial: "white", strap: "mesh" },
  T09: { departmentId: "everyday", subcategoryId: "everyday.weekender", dial: "orange", strap: "rubber" },
  T10: { departmentId: "smart", subcategoryId: "smart.smartone", strap: "titanium", caseSize: 44 },
  T11: { departmentId: "smart", subcategoryId: "smart.hybridactive", dial: "orange", strap: "rubber" },
  T12: { departmentId: "smart", subcategoryId: "smart.connected", strap: "leather", caseSize: 42, dial: "brown" }
};

function slugWords(label) {
  return label.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/);
}

function hash(text) {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function preferredDial(label, deptId) {
  const l = label.toLowerCase();
  if (/(black|onyx|anthracite|carbon|ink|midnight|night|black tie)/.test(l)) return "black";
  if (/(blue|navy|sapphire|gulf|denim|aurora|starlight)/.test(l)) return "blue";
  if (/(green|forest|olive|moss|ocean green)/.test(l)) return "green";
  if (/(white|ivory|pearl|cream|regatta|matte)/.test(l)) return "white";
  if (/(grey|graphite|slate|steel|concrete|granite|stone|steel mesh)/.test(l)) return "grey";
  if (/(brown|bronze|copper|khaki|sand|sandstone|rust|clay|bordeaux|burgundy|heritage brown)/.test(l)) return "brown";
  if (/(silver|champagne|rose gold|warm silver|moon silver)/.test(l)) return "silver";
  if (/(orange|sunset orange|ember)/.test(l)) return "orange";
  return deptId === "dress" ? "champagne" : "blue";
}

function preferredStrap(label, deptId) {
  const l = label.toLowerCase();
  if (/titanium/.test(l)) return "titanium";
  if (/steel mesh|mesh/.test(l)) return "mesh";
  if (/canvas|fabric|weave|denim|olive|moss/.test(l)) return "fabric";
  if (/rubber|sport|dive|track/.test(l)) return "rubber";
  if (/leather|dress|classic|heritage|bordeaux|burgundy|black tie/.test(l)) return "leather";
  if (/steel/.test(l)) return "steel";
  return deptId === "dress" ? "leather" : deptId === "everyday" ? "fabric" : "steel";
}

function preferredMovement(deptId, label) {
  if (deptId === "sport") return "automatic";
  if (deptId === "dress") return /month|moon|heritage|classic/.test(label.toLowerCase()) ? "automatic" : "quartz";
  if (deptId === "everyday") return "quartz";
  return "hybrid";
}

function preferredWater(deptId) {
  if (deptId === "sport") return 300;
  if (deptId === "dress") return 50;
  if (deptId === "everyday") return 100;
  return 50;
}

function preferredCase(deptId, label) {
  if (deptId === "sport") return /trail|aqua/.test(label.toLowerCase()) ? 42 : 44;
  if (deptId === "dress") return 38;
  if (deptId === "everyday") return 38;
  return 44;
}

function preferenceScore(attributes, leaf) {
  const dept = leaf.parentId.split(".")[0];
  const label = leaf.label;
  let score = 0;
  score += attributes.caseSize === preferredCase(dept, label) ? 0 : 2;
  score += attributes.strap === preferredStrap(label, dept) ? 0 : 3;
  score += attributes.movement === preferredMovement(dept, label) ? 0 : 2;
  score += attributes.water === preferredWater(dept) ? 0 : 2;
  score += attributes.dial === preferredDial(label, dept) ? 0 : 3;
  const bandIndex = bands.indexOf(attributes.priceBand);
  const deptBand = dept === "smart" ? 2 : dept === "dress" ? 2 : 1;
  score += Math.abs(bandIndex - deptBand);
  return score;
}

function satisfies(product, criteria) {
  if (criteria.departmentId && product.departmentId !== criteria.departmentId) return false;
  if (criteria.subcategoryId && product.subcategoryId !== criteria.subcategoryId) return false;
  for (const [k, v] of Object.entries(criteria)) {
    if (k === "departmentId" || k === "subcategoryId") continue;
    if (product.attributes[k] !== v) return false;
  }
  return true;
}

const candidates = [];
for (const caseSize of cases)
  for (const strap of straps)
    for (const movement of movements)
      for (const water of waters)
        for (const dial of dials)
          for (const priceBand of bands)
            candidates.push({ caseSize, strap, movement, water, dial, priceBand });

const products = [];
const usedVectors = new Set();

function addProduct(leaf, attributes) {
  const key = JSON.stringify(attributes);
  if (usedVectors.has(key)) throw new Error(`duplicate vector for ${leaf.id}`);
  usedVectors.add(key);
  const band = bands.indexOf(attributes.priceBand);
  const lo = [189, 249, 429, 949][band];
  const span = [50, 170, 470, 1550][band];
  const price = lo + (hash(leaf.id + "price") % span);
  products.push({
    id: leaf.id,
    leafId: leaf.id,
    departmentId: leaf.parentId.split(".")[0],
    subcategoryId: leaf.parentId,
    attributes,
    price,
    priceBand: attributes.priceBand,
    description: `${attributes.caseSize} mm ${attributes.movement} watch with a ${attributes.dial} dial, ${attributes.strap} strap and ${attributes.water} m water resistance.`
  });
}

function resolve(criteria) {
  return products.filter((p) => satisfies(p, criteria));
}

for (const leaf of leaves) {
  if (canonical[leaf.id]) addProduct(leaf, canonical[leaf.id].attributes);
}

for (const [taskId, criteria] of Object.entries(canonicalCriteria)) {
  const matches = resolve(criteria);
  if (matches.length !== 1) throw new Error(`canonical ${taskId} resolves to ${matches.length}`);
}

const domains = { caseSize: cases, strap: straps, movement: movements, water: waters, dial: dials, priceBand: bands };
const keyMap = new Map();
for (let i = 0; i < attrNames.length; i++) {
  for (let j = i + 1; j < attrNames.length; j++) {
    for (let k = j + 1; k < attrNames.length; k++) {
      const names = [attrNames[i], attrNames[j], attrNames[k]];
      for (const a of domains[names[0]])
        for (const b of domains[names[1]])
          for (const c of domains[names[2]]) {
            const key = { [names[0]]: a, [names[1]]: b, [names[2]]: c };
            keyMap.set(JSON.stringify(key), { names, key });
          }
    }
  }
}
const keyList = [...keyMap.values()];

const assignedKeys = [];

for (const leaf of leaves) {
  if (canonical[leaf.id]) continue;
  const deptId = leaf.parentId.split(".")[0];
  const preferred = {
    caseSize: preferredCase(deptId, leaf.label),
    strap: preferredStrap(leaf.label, deptId),
    movement: preferredMovement(deptId, leaf.label),
    water: preferredWater(deptId),
    dial: preferredDial(leaf.label, deptId),
    priceBand: deptId === "sport" || deptId === "everyday" ? "£180–£240" : "£420–£900"
  };

  const keyOptions = keyList
    .map(({ names, key }) => {
      const plausible = names.reduce((sum, n) => sum + (preferred[n] === key[n] ? 1 : 0), 0);
      return { names, key, plausible };
    })
    .filter(({ key }) => !products.some((p) => satisfies(p, key)) && !assignedKeys.some((existing) => Object.entries(key).every(([k, v]) => existing[k] === v)))
    .sort((a, b) => b.plausible - a.plausible || a.names.join(",").localeCompare(b.names.join(",")));

  let chosen = null;
  for (const option of keyOptions) {
    const matching = candidates.filter((c) => option.names.every((n) => c[n] === option.key[n]));
    const ranked = matching
      .map((c) => ({ c, s: preferenceScore(c, leaf) }))
      .sort((a, b) => a.s - b.s || JSON.stringify(a.c).localeCompare(JSON.stringify(b.c)));
    for (const { c } of ranked) {
      const vector = JSON.stringify(c);
      if (usedVectors.has(vector)) continue;
      const probe = { departmentId: leaf.parentId.split(".")[0], subcategoryId: leaf.parentId, attributes: c };
      const breaksCanonical = Object.entries(canonicalCriteria).some(([taskId, criteria]) => {
        const target = products.find((p) => canonical[p.leafId]?.id === taskId);
        return target && target.leafId !== leaf.id && satisfies(probe, criteria);
      });
      if (breaksCanonical) continue;
      if (assignedKeys.some((existing) => satisfies(probe, existing))) continue;
      chosen = { c, key: option.key };
      break;
    }
    if (chosen) break;
  }
  if (!chosen) throw new Error(`no candidate for ${leaf.id}`);
  addProduct(leaf, chosen.c);
  assignedKeys.push(chosen.key);
}

for (const [taskId, criteria] of Object.entries(canonicalCriteria)) {
  const matches = resolve(criteria);
  if (matches.length !== 1) throw new Error(`canonical ${taskId} resolves to ${matches.length}: ${matches.map((p) => p.id).join(", ")}`);
}

const allTasks = [];
for (const [leafId, spec] of Object.entries(canonical)) {
  allTasks.push({
    id: spec.id, targetId: leafId, description: spec.description,
    difficulty: spec.difficulty, canonical: true, criteria: canonicalCriteria[spec.id]
  });
}

// e.g. "Find a 44 mm watch with a black dial, priced £180–£240."
function phraseFor(criteria) {
  const adjectives = [criteria.caseSize ? `${criteria.caseSize} mm` : null, criteria.movement ?? null].filter(Boolean);
  const head = adjectives.length ? `${adjectives.join(" ")} watch` : "watch";
  const article = /^[aeiou]/i.test(head) ? "an" : "a";
  const features = [
    criteria.dial ? `a ${criteria.dial} dial` : null,
    criteria.strap ? `a ${criteria.strap} strap` : null,
    criteria.water ? `${criteria.water} m water resistance` : null
  ].filter(Boolean);
  let phrase = `${article} ${head}`;
  if (features.length) phrase += ` with ${features.join(" and ")}`;
  if (criteria.priceBand) phrase += `, priced ${criteria.priceBand}`;
  if (criteria.departmentId) {
    const dept = byId.get(criteria.departmentId).label;
    if (criteria.subcategoryId) return `In ${dept}, find ${phrase} in the ${byId.get(criteria.subcategoryId).label} range.`;
    return `In ${dept}, find ${phrase}.`;
  }
  return `Find ${phrase}.`;
}

const nonCanonical = leaves.filter((l) => !canonical[l.id]);
const scored = nonCanonical.map((leaf) => {
  const product = products.find((p) => p.leafId === leaf.id);
  const key = assignedKeys[nonCanonical.indexOf(leaf)];
  const deptPos = deptIndex.get(product.departmentId) / 3;
  const subPos = subIndex.get(product.subcategoryId) / 2;
  const labelWords = new Set(slugWords(leaf.label).filter((w) => w.length > 2));
  const taskWords = new Set(slugWords(phraseFor(key)).filter((w) => w.length > 2));
  const overlap = [...labelWords].filter((w) => taskWords.has(w)).length;
  const semantic = 1 - overlap / Math.max(1, new Set([...labelWords, ...taskWords]).size);
  const distractors = products.filter((p) => p.id !== product.id && (p.attributes.dial === product.attributes.dial || p.attributes.strap === product.attributes.strap)).length;
  return {
    product, key,
    score: 0.35 * ((deptPos + subPos) / 2) + 0.4 * semantic + 0.25 * Math.min(1, distractors / 24)
  };
});
scored.sort((a, b) => a.score - b.score || a.product.id.localeCompare(b.product.id));
const targetEasy = 24 - allTasks.filter((t) => t.difficulty === "Easy").length;
const targetMedium = 24 - allTasks.filter((t) => t.difficulty === "Medium").length;
scored.forEach((entry, i) => {
  const difficulty = i < targetEasy ? "Easy" : i < targetEasy + targetMedium ? "Medium" : "Hard";
  allTasks.push({
    id: `T${String(allTasks.length + 1).padStart(2, "0")}`,
    targetId: entry.product.leafId,
    description: phraseFor(entry.key),
    difficulty,
    canonical: false,
    criteria: entry.key
  });
});

allTasks.sort((a, b) => a.id.localeCompare(b.id));
products.sort((a, b) => a.id.localeCompare(b.id));

fs.writeFileSync(path.join(dir, "..", "products.json"), JSON.stringify({ version: "1.0.0", products }, null, 2));
fs.writeFileSync(path.join(dir, "..", "tasks.json"), JSON.stringify({ version: "1.0.0", tasks: allTasks }, null, 2));

const counts = allTasks.reduce((acc, t) => ((acc[t.difficulty] = (acc[t.difficulty] || 0) + 1), acc), {});
console.log(`products: ${products.length}`);
console.log(`tasks: ${allTasks.length}`, counts);
console.log(`unique vectors: ${new Set(products.map((p) => JSON.stringify(p.attributes))).size}`);
