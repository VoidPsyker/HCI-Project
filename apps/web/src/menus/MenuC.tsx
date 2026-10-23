import { useState } from "react";
import { DEPARTMENTS, PALETTE, childrenOf, departmentColour, type TaxonomyNode } from "@meridian/taxonomy";
import type { MenuProps } from "../types";
import { NodeIcon } from "../components/Icon";
import { MenuHeading } from "../components/MenuChrome";

export function MenuC({ menuId, colourMapping, onLeafSelect, onEvent }: MenuProps) {
  const [openDept, setOpenDept] = useState<TaxonomyNode | null>(null);
  const colour = openDept ? PALETTE[departmentColour(openDept.id, colourMapping)] : PALETTE.teal;
  const subcategories = openDept ? childrenOf(openDept.id) : [];

  const toggleDept = (node: TaxonomyNode) => {
    onEvent("node_click", { level: 1, element_id: node.id, element_label: node.label, parent_id: null });
    if (openDept?.id === node.id) {
      setOpenDept(null);
    } else {
      setOpenDept(node);
      onEvent("menu_open", { level: 1, element_id: node.id });
    }
  };
  const reset = () => setOpenDept(null);
  const back = () => {
    onEvent("back", { level: 1 });
    setOpenDept(null);
  };

  return (
    <section className="menu-shell menu-c" data-menu-id={menuId} data-testid="menu-c">
      <MenuHeading
        menuId={menuId}
        title="The whole store, one panel"
        subtitle="Hover or click a department to open all three collections at once."
        path={openDept ? [openDept] : []}
        onHome={reset}
        onBack={openDept ? back : undefined}
      />
      <div className="c-bar">
        {DEPARTMENTS.map((department) => {
          const palette = PALETTE[departmentColour(department.id, colourMapping)];
          const active = openDept?.id === department.id;
          return (
            <button
              key={department.id}
              type="button"
              className="c-tab"
              data-node-id={department.id}
              data-hit-target
              aria-expanded={active}
              onClick={() => toggleDept(department)}
              style={{
                background: active ? palette.bg : palette.soft,
                borderColor: palette.border,
                color: active ? palette.fg : palette.bg
              }}
            >
              <NodeIcon name={department.icon} size={24} />
              <span>{department.label}</span>
            </button>
          );
        })}
      </div>
      {openDept ? (
        <div className="c-mega" style={{ borderColor: colour.border }} data-testid="c-mega">
          <div className="c-promo" style={{ background: colour.soft, borderColor: colour.border }}>
            <div className="b-main-eyebrow">Department</div>
            <h3>{openDept.label}</h3>
            <p>All 18 watches are visible in one panel. Choose any collection and watch directly.</p>
            <div className="c-promo-mark">
              <NodeIcon name={openDept.icon} size={60} />
            </div>
          </div>
          <div className="c-columns">
            {subcategories.map((subcategory) => (
              <div key={subcategory.id} className="c-column">
                <div className="c-column-head">
                  <NodeIcon name={subcategory.icon} size={22} />
                  <span>{subcategory.label}</span>
                </div>
                {childrenOf(subcategory.id).map((leaf) => (
                  <button
                    key={leaf.id}
                    type="button"
                    className="c-leaf"
                    data-node-id={leaf.id}
                    data-hit-target
                    onClick={() => onLeafSelect(leaf)}
                  >
                    <span>{leaf.label}</span>
                    <span className="c-leaf-arrow" aria-hidden="true">
                      â†’
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="c-placeholder">
          <div className="hint-eyebrow">Mega menu</div>
          <h3>One click opens a department</h3>
          <p>
            The panel shows three collections side by side. A second click opens any watch. The panel stays below the
            bar and never covers the current instruction.
          </p>
          <div className="menu-facts">
            <span>2 clicks</span>
            <span>18 watches per department</span>
            <span>No hover-only content</span>
          </div>
        </div>
      )}
    </section>
  );
}


