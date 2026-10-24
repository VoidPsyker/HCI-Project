import { useState } from "react";
import { DEPARTMENTS, PALETTE, childrenOf, departmentColour, type TaxonomyNode } from "@meridian/taxonomy";
import type { MenuProps } from "../types";
import { NodeIcon } from "../components/Icon";
import { MenuHeading, createMenuLog, inputTypeFor, useInert, useMenuOpened } from "../components/MenuChrome";
import { useBrowserBack, type BackSource } from "./browserBack";

export function MenuC({ menuId, colourMapping, onLeafSelect, onEvent, disabled = false }: MenuProps) {
  const [openDept, setOpenDept] = useState<TaxonomyNode | null>(null);
  const shellRef = useInert<HTMLElement>(disabled);
  const colour = openDept ? PALETTE[departmentColour(openDept.id, colourMapping)] : PALETTE.teal;
  const subcategories = openDept ? childrenOf(openDept.id) : [];
  const visibleOptions = openDept ? 18 : 4;
  const log = createMenuLog(onEvent, visibleOptions, disabled);
  useMenuOpened(log);

  const back = (source: BackSource = "control") => {
    if (disabled) return;
    if (openDept) {
      log("back", { level: 1, element_id: openDept.id, element_label: openDept.label, meta: { source, visible_after: 4 } });
      setOpenDept(null);
      return;
    }
    log("back", { level: 0, meta: { source, at_root: true } });
  };
  useBrowserBack(back);

  const toggleDept = (node: TaxonomyNode, inputType: "keyboard" | "mouse") => {
    if (disabled) return;
    log("node_click", {
      level: 1,
      element_id: node.id,
      element_label: node.label,
      parent_id: null,
      input_type: inputType
    });
    if (openDept?.id === node.id) {
      setOpenDept(null);
    } else {
      setOpenDept(node);
      log("menu_open", {
        level: 1,
        element_id: node.id,
        element_label: node.label,
        meta: { visible_options: 18, stage: node.id }
      });
    }
  };
  const reset = () => {
    if (disabled) return;
    setOpenDept(null);
  };

  return (
    <section
      ref={shellRef}
      className="menu-shell menu-c"
      data-menu-id={menuId}
      data-testid="menu-c"
      data-aoi="menu"
      aria-disabled={disabled || undefined}
    >
      <MenuHeading
        menuId={menuId}
        title="The whole store, one panel"
        subtitle="Click a department to open all three collections at once."
        path={openDept ? [openDept] : []}
        onHome={reset}
        onBack={openDept ? () => back("control") : undefined}
        breadcrumb="after-selection"
        onEvent={onEvent}
        visibleOptions={visibleOptions}
        disabled={disabled}
      />
      <div className="c-bar" data-aoi="bar">
        {DEPARTMENTS.map((department) => {
          const palette = PALETTE[departmentColour(department.id, colourMapping)];
          const active = openDept?.id === department.id;
          return (
            <button
              key={department.id}
              type="button"
              className="c-tab"
              data-node-id={department.id}
              data-aoi-level={department.level}
              data-hit-target
              aria-expanded={active}
              onClick={(event) => toggleDept(department, inputTypeFor(event))}
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
        <div className="c-mega" style={{ borderColor: colour.border }} data-testid="c-mega" data-aoi="panel">
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
                <div className="c-column-head" data-node-id={subcategory.id} data-aoi-level={subcategory.level}>
                  <NodeIcon name={subcategory.icon} size={22} />
                  <span>{subcategory.label}</span>
                </div>
                {childrenOf(subcategory.id).map((leaf) => (
                  <button
                    key={leaf.id}
                    type="button"
                    className="c-leaf"
                    data-node-id={leaf.id}
                    data-aoi-level={leaf.level}
                    data-hit-target
                    onClick={(event) => onLeafSelect(leaf, inputTypeFor(event))}
                  >
                    <span>{leaf.label}</span>
                    <span className="c-leaf-arrow" aria-hidden="true">
                      {"\u2192"}
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
