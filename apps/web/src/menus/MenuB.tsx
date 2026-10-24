import { useState } from "react";
import { DEPARTMENTS, PALETTE, childrenOf, departmentColour, type TaxonomyNode } from "@meridian/taxonomy";
import type { MenuProps } from "../types";
import { NodeIcon } from "../components/Icon";
import { MenuHeading, createMenuLog, inputTypeFor, useInert, useMenuOpened } from "../components/MenuChrome";
import { useBrowserBack, type BackSource } from "./browserBack";

export function MenuB({ menuId, colourMapping, onLeafSelect, onEvent, disabled = false }: MenuProps) {
  const [dept, setDept] = useState<TaxonomyNode | null>(null);
  const [sub, setSub] = useState<TaxonomyNode | null>(null);
  const shellRef = useInert<HTMLElement>(disabled);
  const path = dept ? (sub ? [dept, sub] : [dept]) : [];
  const colour = dept ? PALETTE[departmentColour(dept.id, colourMapping)] : PALETTE.teal;
  const subcategories = dept ? childrenOf(dept.id) : [];
  const leaves = sub ? childrenOf(sub.id) : [];
  const visibleOptions = sub ? 6 : dept ? 3 : 4;
  const log = createMenuLog(onEvent, visibleOptions, disabled);
  useMenuOpened(log);

  const back = (source: BackSource = "control") => {
    if (disabled) return;
    if (sub) {
      log("back", { level: 2, element_id: sub.id, element_label: sub.label, meta: { source, visible_after: 3 } });
      setSub(null);
      return;
    }
    if (dept) {
      log("back", { level: 1, element_id: dept.id, element_label: dept.label, meta: { source, visible_after: 4 } });
      setDept(null);
      return;
    }
    log("back", { level: 0, meta: { source, at_root: true } });
  };
  useBrowserBack(back);

  const chooseDept = (node: TaxonomyNode, inputType: "keyboard" | "mouse") => {
    if (disabled) return;
    log("node_click", {
      level: 1,
      element_id: node.id,
      element_label: node.label,
      parent_id: null,
      input_type: inputType
    });
    log("menu_open", {
      level: 1,
      element_id: node.id,
      element_label: node.label,
      meta: { visible_options: 3, stage: node.id }
    });
    setDept(node);
    setSub(null);
  };
  const chooseSub = (node: TaxonomyNode, inputType: "keyboard" | "mouse") => {
    if (disabled) return;
    log("node_click", {
      level: 2,
      element_id: node.id,
      element_label: node.label,
      parent_id: node.parentId,
      input_type: inputType
    });
    log("menu_open", {
      level: 2,
      element_id: node.id,
      element_label: node.label,
      parent_id: node.parentId,
      meta: { visible_options: 6, stage: node.id }
    });
    setSub(node);
  };
  const reset = () => {
    if (disabled) return;
    setDept(null);
    setSub(null);
  };

  return (
    <section
      ref={shellRef}
      className="menu-shell menu-b"
      data-menu-id={menuId}
      data-testid="menu-b"
      data-aoi="menu"
      aria-disabled={disabled || undefined}
    >
      <MenuHeading
        menuId={menuId}
        title="Browse the catalogue"
        subtitle="The sidebar keeps every level in view as you drill down."
        path={path}
        onHome={reset}
        onBack={dept ? () => back("control") : undefined}
        breadcrumb="after-selection"
        onEvent={onEvent}
        visibleOptions={visibleOptions}
        disabled={disabled}
      />
      <div className="b-layout">
        <aside
          className="b-sidebar"
          style={{ borderColor: colour.border }}
          aria-label="Catalogue sidebar"
          data-aoi="sidebar"
        >
          <div className="b-sidebar-title">
            <span>Departments</span>
            <small>4</small>
          </div>
          {DEPARTMENTS.map((department) => {
            const palette = PALETTE[departmentColour(department.id, colourMapping)];
            const active = dept?.id === department.id;
            return (
              <div key={department.id} className="b-group">
                <button
                  type="button"
                  className={active ? "b-dept b-dept-active" : "b-dept"}
                  data-node-id={department.id}
                  data-aoi-level={department.level}
                  data-hit-target
                  aria-expanded={active}
                  onClick={(event) => chooseDept(department, inputTypeFor(event))}
                  style={active ? { background: palette.soft, borderColor: palette.border, color: palette.bg } : undefined}
                >
                  <NodeIcon name={department.icon} size={22} />
                  <span>{department.label}</span>
                  <span className="b-arrow" aria-hidden="true">
                    {active ? "\u2212" : "+"}
                  </span>
                </button>
                {active ? (
                  <div className="b-sub-list">
                    {subcategories.map((subcategory) => {
                      const subActive = sub?.id === subcategory.id;
                      return (
                        <div key={subcategory.id}>
                          <button
                            type="button"
                            className={subActive ? "b-sub b-sub-active" : "b-sub"}
                            data-node-id={subcategory.id}
                            data-aoi-level={subcategory.level}
                            data-hit-target
                            aria-expanded={subActive}
                            onClick={(event) => chooseSub(subcategory, inputTypeFor(event))}
                          >
                            <NodeIcon name={subcategory.icon} size={18} />
                            <span>{subcategory.label}</span>
                            <span className="b-arrow" aria-hidden="true">
                              {subActive ? "\u2212" : "+"}
                            </span>
                          </button>
                          {subActive ? (
                            <div className="b-leaves">
                              {leaves.map((leaf) => (
                                <button
                                  key={leaf.id}
                                  type="button"
                                  className="b-leaf"
                                  data-node-id={leaf.id}
                                  data-aoi-level={leaf.level}
                                  data-hit-target
                                  onClick={(event) => onLeafSelect(leaf, inputTypeFor(event))}
                                >
                                  <span className="b-dot" aria-hidden="true" />
                                  {leaf.label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </aside>
        <div className="b-main" data-aoi="content">
          <div className="b-main-card" style={{ borderColor: colour.border }}>
            {sub ? (
              <>
                <div className="b-main-eyebrow">Collection</div>
                <h3>{sub.label}</h3>
                <p>Six watches are available in this collection. Choose one from the open sidebar list.</p>
                <div className="b-static-grid">
                  {leaves.map((leaf) => (
                    <div key={leaf.id} className="b-static-leaf">
                      <NodeIcon name="Watch" size={22} />
                      <span>{leaf.label}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : dept ? (
              <>
                <div className="b-main-eyebrow">Department</div>
                <h3>{dept.label}</h3>
                <p>Choose one of the three collections in the sidebar. The sidebar stays open so you can change course.</p>
                <div className="b-collection-row">
                  {subcategories.map((subcategory) => (
                    <div key={subcategory.id} className="b-collection">
                      <NodeIcon name={subcategory.icon} size={24} />
                      <span>{subcategory.label}</span>
                      <small>6 styles</small>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="b-main-eyebrow">Vertical sidebar</div>
                <h3>Select a department</h3>
                <p>Every department, collection and watch stays in the left rail. Nothing covers the catalogue.</p>
                <div className="menu-facts">
                  <span>3 clicks</span>
                  <span>Persistent rail</span>
                  <span>72 watches</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
