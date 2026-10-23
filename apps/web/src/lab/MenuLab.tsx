import { useMemo, useState } from "react";
import { MENU_IDS, NODE_BY_ID, type ColourMapping, type MenuId, type TaxonomyNode } from "@meridian/taxonomy";
import type { StateLabel } from "@meridian/scoring";
import { MENU_NAMES, ProductDetail } from "../components/MenuChrome";
import { MenuA } from "../menus/MenuA";
import { MenuB } from "../menus/MenuB";
import { MenuC } from "../menus/MenuC";
import { MenuD } from "../menus/MenuD";
import { MenuE } from "../menus/MenuE";
import { MenuF } from "../menus/MenuF";

const MENUS = { A: MenuA, B: MenuB, C: MenuC, D: MenuD, E: MenuE, F: MenuF };
const MAPPINGS: Array<{ id: string; label: string; value: ColourMapping }> = [
  { id: "default", label: "Default mapping", value: { sport: "teal", dress: "amber", everyday: "olive", smart: "indigo" } },
  { id: "shift", label: "Shifted mapping", value: { sport: "indigo", dress: "teal", everyday: "amber", smart: "olive" } },
  { id: "reverse", label: "Reverse mapping", value: { sport: "olive", dress: "indigo", everyday: "teal", smart: "amber" } }
];

export function MenuLab() {
  const [menuId, setMenuId] = useState<MenuId>("A");
  const [stateLabel, setStateLabel] = useState<StateLabel>("mixed");
  const [mappingId, setMappingId] = useState("default");
  const [leaf, setLeaf] = useState<TaxonomyNode | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const mapping = useMemo(() => MAPPINGS.find((item) => item.id === mappingId)?.value ?? MAPPINGS[0]!.value, [mappingId]);
  const Menu = MENUS[menuId];

  return (
    <div className="lab-shell">
      <header className="lab-header">
        <div>
          <div className="eyebrow">Researcher tools</div>
          <h1>Menu lab</h1>
          <p className="small-note">Click through every layout without creating a session. Nothing is logged to the study database.</p>
        </div>
        <div className="lab-controls">
          <label className="field compact">
            <span>Menu</span>
            <select value={menuId} onChange={(event) => { setMenuId(event.target.value as MenuId); setLeaf(null); }}>
              {MENU_IDS.map((id) => (
                <option key={id} value={id}>
                  {id} · {MENU_NAMES[id]}
                </option>
              ))}
            </select>
          </label>
          <label className="field compact">
            <span>State context</span>
            <select value={stateLabel} onChange={(event) => setStateLabel(event.target.value as StateLabel)}>
              {(["happy", "frustrated", "confused", "bored", "mixed"] as const).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="field compact">
            <span>Colour mapping</span>
            <select value={mappingId} onChange={(event) => setMappingId(event.target.value)}>
              {MAPPINGS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <a className="button secondary" href="/admin">
            Researcher console
          </a>
          <a className="button quiet" href="/">
            Home
          </a>
        </div>
      </header>
      <div className="stage-viewport lab-stage-viewport">
        <div className="stage lab-stage" style={{ transform: "scale(var(--stage-scale, 1))" }}>
          <div className="lab-canvas">
            <div className="lab-badge">
              Menu {menuId} · {MENU_NAMES[menuId]} · {stateLabel}
            </div>
            <Menu
              menuId={menuId}
              colourMapping={mapping}
              onLeafSelect={(node) => {
                setLeaf(node);
                setEvents((current) => [`leaf_select ${node.label}`, ...current].slice(0, 8));
              }}
              onEvent={(type, payload) => {
                setEvents((current) =>
                  [`${type} ${String(payload?.element_label ?? payload?.element_id ?? "")}`.trim(), ...current].slice(0, 8)
                );
              }}
            />
            {leaf ? (
              <div className="product-overlay">
                <ProductDetail
                  productId={leaf.productId ?? leaf.id}
                  onBack={() => setLeaf(null)}
                  onNext={undefined}
                  nextLabel=""
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <aside className="lab-event-strip" aria-label="Lab events">
        <span>Local event preview</span>
        {events.length ? events.map((item, index) => <code key={`${item}-${index}`}>{item}</code>) : <em>Click a node to preview events.</em>}
      </aside>
    </div>
  );
}
