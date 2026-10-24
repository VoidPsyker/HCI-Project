import { useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { DEPARTMENTS, PALETTE, childrenOf, departmentColour, type TaxonomyNode } from "@meridian/taxonomy";
import type { MenuProps } from "../types";
import { NodeIcon } from "../components/Icon";
import { MenuHeading, createMenuLog, inputTypeFor, useInert, useMenuOpened } from "../components/MenuChrome";
import { useBrowserBack, type BackSource } from "./browserBack";

export function MenuA({ menuId, colourMapping, onLeafSelect, onEvent, disabled = false }: MenuProps) {
  const [openDept, setOpenDept] = useState<string | null>(null);
  const [sub, setSub] = useState<TaxonomyNode | null>(null);
  const itemInput = useRef<"keyboard" | "mouse">("mouse");
  const shellRef = useInert<HTMLElement>(disabled);
  const dept = openDept ? DEPARTMENTS.find((d) => d.id === openDept) : sub ? DEPARTMENTS.find((d) => d.id === sub.parentId) : null;
  const path = dept ? (sub ? [dept, sub] : [dept]) : [];
  const colour = dept ? PALETTE[departmentColour(dept.id, colourMapping)] : PALETTE.teal;
  const visibleOptions = sub ? 6 : openDept ? 3 : 4;
  const log = createMenuLog(onEvent, visibleOptions, disabled);
  useMenuOpened(log);

  const back = (source: BackSource = "control") => {
    if (disabled) return;
    if (sub) {
      log("back", { level: 2, element_id: sub.id, element_label: sub.label, meta: { source, visible_after: 3 } });
      setSub(null);
      setOpenDept(sub.parentId);
      return;
    }
    if (openDept) {
      const department = DEPARTMENTS.find((d) => d.id === openDept);
      log("back", {
        level: 1,
        element_id: openDept,
        element_label: department?.label,
        meta: { source, visible_after: 4 }
      });
      setOpenDept(null);
      return;
    }
    log("back", { level: 0, meta: { source, at_root: true } });
  };
  useBrowserBack(back);

  const handleOpen = (value: boolean, id: string) => {
    if (disabled) return;
    if (!value) {
      setOpenDept(null);
      return;
    }
    const department = DEPARTMENTS.find((d) => d.id === id);
    setOpenDept(id);
    setSub(null);
    log("menu_open", {
      level: 1,
      element_id: id,
      element_label: department?.label,
      meta: { visible_options: 3, stage: id }
    });
  };

  const selectSub = (node: TaxonomyNode, inputType: "keyboard" | "mouse" = "mouse") => {
    if (disabled) return;
    log("node_click", {
      level: 2,
      element_id: node.id,
      element_label: node.label,
      parent_id: node.parentId,
      input_type: inputType,
      meta: { visible_after: 6 }
    });
    log("menu_open", {
      level: 2,
      element_id: node.id,
      element_label: node.label,
      parent_id: node.parentId,
      meta: { visible_options: 6, stage: node.id }
    });
    setSub(node);
    setOpenDept(null);
  };

  const reset = () => {
    if (disabled) return;
    setOpenDept(null);
    setSub(null);
  };

  return (
    <section
      ref={shellRef}
      className="menu-shell menu-a"
      data-menu-id={menuId}
      data-testid="menu-a"
      data-aoi="menu"
      aria-disabled={disabled || undefined}
    >
      <MenuHeading
        menuId={menuId}
        title="Shop by department"
        subtitle="Choose a department, then a collection, then a watch."
        path={path}
        onHome={reset}
        onBack={sub || openDept ? () => back("control") : undefined}
        breadcrumb="after-selection"
        onEvent={onEvent}
        visibleOptions={visibleOptions}
        disabled={disabled}
      />
      <div className="a-bar" style={{ borderColor: colour.border }} data-aoi="bar">
        {DEPARTMENTS.map((department) => {
          const palette = PALETTE[departmentColour(department.id, colourMapping)];
          return (
            <DropdownMenu.Root
              key={department.id}
              modal={false}
              open={!disabled && openDept === department.id}
              onOpenChange={(value) => handleOpen(value, department.id)}
            >
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="a-tab"
                  data-node-id={department.id}
                  data-aoi-level={department.level}
                  data-hit-target
                  aria-label={`${department.label} department`}
                  style={{
                    background: openDept === department.id ? palette.bg : palette.soft,
                    color: openDept === department.id ? palette.fg : palette.bg,
                    borderColor: palette.border
                  }}
                  onClick={(event) =>
                    // Radix opens on pointerdown, so pin the click to the level it leaves.
                    log("node_click", {
                      level: 1,
                      element_id: department.id,
                      element_label: department.label,
                      input_type: inputTypeFor(event),
                      meta: { visible_options: 4 }
                    })
                  }
                >
                  <NodeIcon name={department.icon} size={26} />
                  <span>{department.label}</span>
                  <span className="a-caret" aria-hidden="true">
                    {"\u25BE"}
                  </span>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content className="a-dropdown" align="start" sideOffset={8} data-aoi="dropdown">
                <div className="dropdown-title">{department.label} collections</div>
                {childrenOf(department.id).map((subcategory) => (
                  <DropdownMenu.Item
                    key={subcategory.id}
                    className="a-dropdown-item"
                    data-node-id={subcategory.id}
                    data-aoi-level={subcategory.level}
                    data-hit-target
                    onClick={(event) => {
                      itemInput.current = inputTypeFor(event);
                    }}
                    onSelect={() => selectSub(subcategory, itemInput.current)}
                  >
                    <NodeIcon name={subcategory.icon} size={22} />
                    <span>{subcategory.label}</span>
                    <small>6 styles</small>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          );
        })}
      </div>
      <div className="a-stage">
        {sub ? (
          <div className="a-flyout" style={{ borderColor: colour.border }} data-testid="a-flyout" data-aoi="flyout">
            <div className="flyout-title">{sub.label}</div>
            <div className="flyout-sub">Choose one of the six watches.</div>
            <div className="a-leaf-list">
              {childrenOf(sub.id).map((leaf) => (
                <button
                  key={leaf.id}
                  type="button"
                  className="a-leaf"
                  data-node-id={leaf.id}
                  data-aoi-level={leaf.level}
                  data-hit-target
                  onClick={(event) => onLeafSelect(leaf, inputTypeFor(event))}
                >
                  <span className="leaf-icon">
                    <NodeIcon name="Watch" size={20} />
                  </span>
                  <span>{leaf.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="a-hint">
            <div className="hint-eyebrow">Horizontal bar</div>
            <h3>{dept ? "Now choose a collection" : "Start with a department"}</h3>
            <p>
              The department menu opens below the header. Collection options then appear beside the bar so the whole
              path stays visible.
            </p>
            <div className="menu-facts">
              <span>3 clicks</span>
              <span>4 departments</span>
              <span>72 watches</span>
            </div>
          </div>
        )}
        <div className="a-art" aria-hidden="true">
          <div className="a-art-ring" style={{ borderColor: colour.border }} />
          <div className="a-art-card">MERIDIAN</div>
        </div>
      </div>
    </section>
  );
}
