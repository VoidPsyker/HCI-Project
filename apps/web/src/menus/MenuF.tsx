import { useState } from "react";
import * as d3 from "d3";
import { DEPARTMENTS, PALETTE, childrenOf, departmentColour, departmentOf, type TaxonomyNode } from "@meridian/taxonomy";
import type { MenuProps } from "../types";
import { MenuHeading } from "../components/MenuChrome";

const W = 1120;
const H = 700;
const CX = W / 2;
const CY = H / 2 + 10;

function polar(angle: number, radius: number): { x: number; y: number } {
  return { x: CX + Math.sin(angle) * radius, y: CY - Math.cos(angle) * radius };
}

export function MenuF({ menuId, colourMapping, onLeafSelect, onEvent }: MenuProps) {
  const [path, setPath] = useState<TaxonomyNode[]>([]);
  const items: TaxonomyNode[] =
    path.length === 0 ? DEPARTMENTS : path.length === 1 ? childrenOf(path[0]!.id) : childrenOf(path[1]!.id);
  const dept = path.length ? departmentOf(path[path.length - 1]!.id) : null;
  const colour = dept ? PALETTE[departmentColour(dept.id, colourMapping)] : PALETTE.teal;
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

  const choose = (node: TaxonomyNode) => {
    if (node.level === 3) {
      onLeafSelect(node);
      return;
    }
    onEvent("node_click", { level: node.level, element_id: node.id, element_label: node.label, parent_id: node.parentId });
    setPath([...path, node]);
  };
  const back = () => {
    if (!path.length) return;
    onEvent("back", { level: path.length });
    setPath(path.slice(0, -1));
  };
  const reset = () => setPath([]);

  const radius = path.length === 0 ? 235 : path.length === 1 ? 205 : 282;
  const angleStep = (Math.PI * 2) / Math.max(items.length, 1);
  const angleOffset = items.length === 4 ? angleStep / 2 : -Math.PI / 2;

  return (
    <section className="menu-shell menu-f" data-menu-id={menuId} data-testid="menu-f">
      <MenuHeading
        menuId={menuId}
        title="Radial lattice"
        subtitle="The catalogue is arranged around a hub. Each choice moves you outward."
        path={path}
        onHome={reset}
        onBack={path.length ? back : undefined}
      />
      <div className="f-frame" style={{ borderColor: colour.border }}>
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
            const w = leaf ? 174 : 196;
            const h = 56;
            return (
              <g key={node.id}>
                <line x1={CX} y1={CY} x2={point.x} y2={point.y} stroke={palette.border} strokeWidth="1.2" opacity="0.35" />
                <g
                  className="f-node"
                  role="button"
                  tabIndex={0}
                  aria-label={node.label}
                  data-node-id={node.id}
                  transform={`translate(${point.x}, ${point.y})`}
                  onClick={() => choose(node)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      choose(node);
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
                  <circle cx={-w / 2 + 25} cy={0} r={5} fill={leaf ? palette.bg : "#ffffff"} />
                  <text
                    x={12}
                    y={-2}
                    textAnchor="middle"
                    className={leaf ? "f-node-label f-node-label-leaf" : "f-node-label"}
                    fill={leaf ? "#0f172a" : "#ffffff"}
                  >
                    {node.label}
                  </text>
                  <text
                    x={12}
                    y={15}
                    textAnchor="middle"
                    className="f-node-meta"
                    fill={leaf ? "#475569" : "rgba(255,255,255,0.76)"}
                  >
                    {node.level === 1 ? "Department" : node.level === 2 ? "6 watches" : "View product"}
                  </text>
                </g>
              </g>
            );
          })}
          <g
            className="f-hub"
            data-testid="f-hub"
            role="button"
            tabIndex={0}
            aria-label={path.length ? "Back to the previous ring" : "Meridian catalogue hub"}
            onClick={back}
            onKeyDown={(event) => {
              if ((event.key === "Enter" || event.key === " ") && path.length) {
                event.preventDefault();
                back();
              }
            }}
          >
            <circle cx={CX} cy={CY} r={70} fill={path.length ? colour.bg : "#0f172a"} />
            <text x={CX} y={CY - 6} textAnchor="middle" className="f-hub-title">
              MERIDIAN
            </text>
            <text x={CX} y={CY + 16} textAnchor="middle" className="f-hub-sub">
              {path.length ? "â† Back" : "Catalogue"}
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


