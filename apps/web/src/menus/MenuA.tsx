import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { DEPARTMENTS, PALETTE, childrenOf, departmentColour, type TaxonomyNode } from "@meridian/taxonomy";
import type { MenuProps } from "../types";
import { NodeIcon } from "../components/Icon";
import { MenuHeading } from "../components/MenuChrome";

export function MenuA({ menuId, colourMapping, onLeafSelect, onEvent }: MenuProps) {
  const [openDept, setOpenDept] = useState<string | null>(null);
  const [sub, setSub] = useState<TaxonomyNode | null>(null);
  const dept = openDept ? DEPARTMENTS.find((d) => d.id === openDept) : sub ? DEPARTMENTS.find((d) => d.id === sub.parentId) : null;
  const path = dept ? (sub ? [dept, sub] : [dept]) : [];
  const colour = dept ? PALETTE[departmentColour(dept.id, colourMapping)] : PALETTE.teal;

  const handleOpen = (value: boolean, id: string) => {
    setOpenDept(value ? id : null);
    if (value) {
      setSub(null);
      onEvent("menu_open", { level: 1, element_id: id });
    }
  };

  const selectSub = (node: TaxonomyNode) => {
    onEvent("node_click", { level: 2, element_id: node.id, element_label: node.label, parent_id: node.parentId });
    setSub(node);
    setOpenDept(null);
  };

  const reset = () => {
    setOpenDept(null);
    setSub(null);
  };
  const back = () => {
    onEvent("back", { level: sub ? 2 : 1 });
    setSub(null);
  };

  return (
    <section className="menu-shell menu-a" data-menu-id={menuId} data-testid="menu-a">
      <MenuHeading
        menuId={menuId}
        title="Shop by department"
        subtitle="Choose a department, then a collection, then a watch."
        path={path}
        onHome={reset}
        onBack={sub ? back : undefined}
      />
      <div className="a-bar" style={{ borderColor: colour.border }}>
        {DEPARTMENTS.map((department) => {
          const palette = PALETTE[departmentColour(department.id, colourMapping)];
          return (
            <DropdownMenu.Root
              key={department.id}
              open={openDept === department.id}
              onOpenChange={(value) => handleOpen(value, department.id)}
            >
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="a-tab"
                  data-node-id={department.id}
                  data-hit-target
                  aria-label={`${department.label} department`}
                  style={{
                    background: openDept === department.id ? palette.bg : palette.soft,
                    color: openDept === department.id ? palette.fg : palette.bg,
                    borderColor: palette.border
                  }}
                  onClick={() =>
                    onEvent("node_click", { level: 1, element_id: department.id, element_label: department.label })
                  }
                >
                  <NodeIcon name={department.icon} size={26} />
                  <span>{department.label}</span>
                  <span className="a-caret" aria-hidden="true">
                    â–¾
                  </span>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content className="a-dropdown" align="start" sideOffset={8}>
                <div className="dropdown-title">{department.label} collections</div>
                {childrenOf(department.id).map((subcategory) => (
                  <DropdownMenu.Item
                    key={subcategory.id}
                    className="a-dropdown-item"
                    data-node-id={subcategory.id}
                    data-hit-target
                    onSelect={() => selectSub(subcategory)}
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
          <div className="a-flyout" style={{ borderColor: colour.border }} data-testid="a-flyout">
            <div className="flyout-title">{sub.label}</div>
            <div className="flyout-sub">Choose one of the six watches.</div>
            <div className="a-leaf-list">
              {childrenOf(sub.id).map((leaf) => (
                <button
                  key={leaf.id}
                  type="button"
                  className="a-leaf"
                  data-node-id={leaf.id}
                  data-hit-target
                  onClick={() => onLeafSelect(leaf)}
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


