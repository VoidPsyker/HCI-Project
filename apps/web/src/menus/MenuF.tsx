import { useState } from "react";
import * as d3 from "d3";
import { DEPARTMENTS, PALETTE, childrenOf, departmentColour, departmentOf, type TaxonomyNode } from "@meridian/taxonomy";
import type { MenuProps } from "../types";
import { NodeIcon } from "../components/Icon";
import { MenuHeading, createMenuLog, useInert, useMenuOpened } from "../components/MenuChrome";
import { useBrowserBack, type BackSource } from "./browserBack";

const W = 1120;
const H = 700;
const CX = W / 2;
const CY = H / 2 + 10;

function polar(angle: number, radius: number): { x: number; y: number } {
  return { x: CX + Math.sin(angle) * radius, y: CY - Math.cos(angle) * radius };
}

export function MenuF({ menuId, colourMapping, onLeafSelect, onEvent, disabled = false }: MenuProps) {
  const [path, setPath] = useState<TaxonomyNode[]>([]);
  const shellRef = useInert<HTMLElement>(disabled);
  const items: TaxonomyNode[] =
    path.length === 0 ? DEPARTMENTS : path.length === 1 ? childrenOf(path[0]!.id) : childrenOf(path[1]!.id);
  const dept = path.length ? departmentOf(path[path.length - 1]!.id) : null;
  const colour = dept ? PALETTE[departmentColour(dept.id, colourMapping)] : PALETTE.teal;
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

  const arcs = DEPARTMENTS.map((department, index) => {
    const step = (Math.PI * 2) / 4;
    const start = index * step;
    const end = start + step - 0.035;
    const palette = PALETTE[departmentColour(department.id, colourMapping)];
    return {
      id: department.id,
      d: d3.arc()({ innerRadius: 82, outerRadius: 320, startAngle: start, endAngle: end }) ?? "",
      fill: palette.soft,
      stroke: palette.border
    };
  });

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

  const radius = path.length === 0 ? 235 : path.length === 1 ? 205 : 282;
  const angleStep = (Math.PI * 2) / Math.max(items.length, 1);
  const angleOffset = items.length === 4 ? angleStep / 2 : -Math.PI / 2;

  return (
    <section
      ref={shellRef}
      className="menu-shell menu-f"
      data-menu-id={menuId}
      data-testid="menu-f"
      data-aoi="menu"
      aria-disabled={disabled || undefined}
    >
      <MenuHeading
        menuId={menuId}
        title="Radial lattice"
        subtitle="The catalogue is arranged around a hub. Each choice moves you outward."
        path={path}
        onHome={reset}
        onBack={path.length ? () => back("control") : undefined}
        breadcrumb="always"
        onEvent={onEvent}
        visibleOptions={visibleOptions}
        disabled={disabled}
      />
      <div className="f-frame" style={{ borderColor: colour.border }} data-aoi="rings">
        <svg viewBox={`0 0 ${W} ${H}`} className="f-svg" role="group" aria-label="Radial lattice menu" data-testid="f-svg">
          <circle cx={CX} cy={CY} r={320} fill="#ffffff" stroke="#e2e8f0" />
          <circle cx={CX} cy={CY} r={82} fill={path.length ? colour.soft : "#f8fafc"} stroke={colour.border} strokeWidth="2" />
          {path.length === 0
            ? arcs.map((arc) => (
                <path key={arc.id} d={arc.d} fill={arc.fill} stroke={arc.stroke} strokeWidth="1.5" opacity="0.9" />
              ))
            : null}
          {[205, 282].map((r) => (
            <circle key={r} cx={CX} cy={CY} r={r} fill="none" stroke="#cbd5e1" strokeWidth="1.2" strokeDasharray="4 7" />
          ))}
          {items.map((node, index) => {
            const nodeDept = departmentOf(node.id);
            const palette = PALETTE[departmentColour(nodeDept?.id ?? node.id, colourMapping)];
            const angle = angleOffset + index * angleStep;
            const point = polar(angle, radius);
            const leaf = node.level === 3;
            const meta = node.level === 1 ? "Department" : node.level === 2 ? "6 watches" : "View product";
            const w = leaf ? 174 : 196;
            const h = 56;
            return (
              <g key={node.id}>
                <line x1={CX} y1={CY} x2={point.x} y2={point.y} stroke={palette.border} strokeWidth="1.2" opacity="0.35" />
                <g
                  className="f-node"
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.label} ${meta}`}
                  data-node-id={node.id}
                  data-aoi-level={node.level}
                  transform={`translate(${point.x}, ${point.y})`}
                  onClick={() => choose(node, "mouse")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      choose(node, "keyboard");
                    }
                  }}
                >
                  <rect
                    data-hit-target
                    x={-w / 2}
                    y={-h / 2}
                    width={w}
                    height={h}
                    rx={h / 2}
                    fill={leaf ? palette.soft : palette.bg}
                    stroke={palette.border}
                    strokeWidth="2"
                  />
                  <foreignObject x={-w / 2 + 8} y={-16} width={32} height={32}>
                    <div
                      className="f-icon"
                      style={{ background: leaf ? "#ffffff" : "rgba(255,255,255,0.16)", color: leaf ? palette.bg : "#ffffff" }}
                    >
                      <NodeIcon name={leaf ? "Watch" : node.icon} size={19} />
                    </div>
                  </foreignObject>
                  <text
                    x={-w / 2 + 48}
                    y={-2}
                    textAnchor="start"
                    className={leaf ? "f-node-label f-node-label-leaf" : "f-node-label"}
                    fill={leaf ? "#0f172a" : "#ffffff"}
                  >
                    {`${node.label} `}
                  </text>
                  <text
                    x={-w / 2 + 48}
                    y={15}
                    textAnchor="start"
                    className="f-node-meta"
                    fill={leaf ? "#475569" : "#ffffff"}
                  >
                    {meta}
                  </text>
                </g>
              </g>
            );
          })}
          <g
            className="f-hub"
            data-testid="f-hub"
            data-node-id="hub"
            role="button"
            tabIndex={0}
            aria-label={path.length ? "Meridian Back" : "Meridian catalogue hub"}
            onClick={() => back("control")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                back("control");
              }
            }}
          >
            <circle cx={CX} cy={CY} r={70} fill={path.length ? colour.bg : "#0f172a"} />
            <text x={CX} y={CY - 6} textAnchor="middle" className="f-hub-title">
              {"MERIDIAN "}
            </text>
            <text x={CX} y={CY + 16} textAnchor="middle" className="f-hub-sub">
              {path.length ? "\u2190 Back" : "Catalogue"}
            </text>
          </g>
        </svg>
        <div className="f-caption">
          <span>{path.length ? `${items.length} choices on this ring` : "Four departments"}</span>
          <span className="f-caption-note">Click outward; use the hub to move back.</span>
        </div>
      </div>
    </section>
  );
}
