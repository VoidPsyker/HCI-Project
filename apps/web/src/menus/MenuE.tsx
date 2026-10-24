import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { DEPARTMENTS, PALETTE, childrenOf, departmentColour, departmentOf, type TaxonomyNode } from "@meridian/taxonomy";
import type { MenuProps } from "../types";
import { NodeIcon } from "../components/Icon";
import { MenuHeading, createMenuLog, inputTypeFor, useInert, useMenuOpened } from "../components/MenuChrome";
import { useBrowserBack, type BackSource } from "./browserBack";

export function MenuE({ menuId, colourMapping, onLeafSelect, onEvent, disabled = false }: MenuProps) {
  const [path, setPath] = useState<TaxonomyNode[]>([]);
  const reduced = useReducedMotion();
  const shellRef = useInert<HTMLElement>(disabled);
  const items = path.length === 0 ? DEPARTMENTS : path.length === 1 ? childrenOf(path[0]!.id) : childrenOf(path[1]!.id);
  const dept = path.length ? departmentOf(path[path.length - 1]!.id) : null;
  const colour = dept ? PALETTE[departmentColour(dept.id, colourMapping)] : PALETTE.teal;
  const levelKey = path.map((node) => node.id).join("/") || "root";
  const visibleOptions = items.length;
  const log = createMenuLog(onEvent, visibleOptions, disabled);
  useMenuOpened(log);

  const back = (source: BackSource = "control") => {
    if (disabled) return;
    if (!path.length) {
      log("back", { level: 0, meta: { source, at_root: true } });
      return;
    }
    const current = path[path.length - 1];
    log("back", {
      level: path.length,
      element_id: current?.id,
      element_label: current?.label,
      meta: { source, visible_after: path.length === 1 ? 4 : 3 }
    });
    setPath(path.slice(0, -1));
  };
  useBrowserBack(back);

  const choose = (node: TaxonomyNode, inputType: "keyboard" | "mouse") => {
    if (disabled) return;
    if (node.level === 3) {
      onLeafSelect(node, inputType);
      return;
    }
    const nextVisible = childrenOf(node.id).length;
    log("node_click", {
      level: node.level,
      element_id: node.id,
      element_label: node.label,
      parent_id: node.parentId,
      input_type: inputType,
      meta: { visible_after: nextVisible }
    });
    log("menu_open", {
      level: node.level,
      element_id: node.id,
      element_label: node.label,
      parent_id: node.parentId,
      meta: { visible_options: nextVisible, stage: node.id }
    });
    setPath([...path, node]);
  };
  const reset = () => {
    if (disabled) return;
    setPath([]);
  };

  return (
    <section
      ref={shellRef}
      className="menu-shell menu-e"
      data-menu-id={menuId}
      data-testid="menu-e"
      data-aoi="menu"
      aria-disabled={disabled || undefined}
    >
      <MenuHeading
        menuId={menuId}
        title="Icon grid"
        subtitle="Rounded cards reflow at each level. Icons and labels stay paired."
        path={path}
        onHome={reset}
        onBack={path.length ? () => back("control") : undefined}
        breadcrumb="compact"
        onEvent={onEvent}
        visibleOptions={visibleOptions}
        disabled={disabled}
      />
      <div className="e-frame" style={{ borderColor: colour.border }} data-aoi="icon-grid">
        <div className="e-grid" data-testid="e-grid">
          <AnimatePresence mode="popLayout" initial={false}>
            {path.length ? (
              <motion.button
                key="back"
                type="button"
                className="e-card e-back"
                onClick={() => back("control")}
                initial={reduced ? false : { opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ duration: reduced ? 0 : 0.18 }}
                layout
              >
                <span className="e-back-arrow">{"\u2190"}</span>
                <span>Back</span>
              </motion.button>
            ) : null}
            {items.map((node) => {
              const nodeDept = departmentOf(node.id);
              const palette = PALETTE[departmentColour(nodeDept?.id ?? node.id, colourMapping)];
              const leaf = node.level === 3;
              return (
                <motion.button
                  key={`${levelKey}:${node.id}`}
                  type="button"
                  className={leaf ? "e-card e-card-leaf" : "e-card"}
                  data-node-id={node.id}
                  data-aoi-level={node.level}
                  data-hit-target
                  onClick={(event) => choose(node, inputTypeFor(event))}
                  initial={reduced ? false : { opacity: 0, y: 12, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: reduced ? 0 : 0.2 }}
                  layout
                  style={{
                    background: leaf ? palette.soft : palette.bg,
                    borderColor: palette.border,
                    color: leaf ? "#0f172a" : "#ffffff"
                  }}
                >
                  <span className="e-icon" style={{ background: leaf ? "#ffffff" : "rgba(255,255,255,0.16)", color: leaf ? palette.bg : "#ffffff" }}>
                    <NodeIcon name={leaf ? "Watch" : node.icon} size={leaf ? 30 : 38} />
                  </span>
                  <span className="e-label">{node.label}</span>
                  <span className="e-meta" style={{ color: leaf ? "#475569" : "#ffffff" }}>
                    {node.level === 1 ? "Department" : node.level === 2 ? "6 watches" : "View product"}
                  </span>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
