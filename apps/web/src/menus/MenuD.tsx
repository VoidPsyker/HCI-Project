import { useRef, useState } from "react";
import * as d3 from "d3";
import {
  DEPARTMENTS,
  PALETTE,
  childrenOf,
  departmentColour,
  departmentOf,
  NODE_BY_ID,
  type TaxonomyNode
} from "@meridian/taxonomy";
import type { MenuProps } from "../types";
import { NodeIcon } from "../components/Icon";
import { MenuHeading } from "../components/MenuChrome";

interface Tile {
  key: string;
  node: TaxonomyNode | null;
  x: number;
  y: number;
  w: number;
  h: number;
  back: boolean;
}

const W = 1200;
const H = 690;

function layoutTiles(items: TaxonomyNode[], hasBack: boolean): Tile[] {
  const count = items.length + (hasBack ? 1 : 0);
  const cols = count <= 4 ? 2 : 4;
  const rows = Math.ceil(count / cols);
  const gap = 22;
  const startX = 22;
  const startY = 30;
  const w = (W - startX * 2 - gap * (cols - 1)) / cols;
  const h = (H - startY * 2 - gap * (rows - 1)) / rows;
  const tiles: Tile[] = items.map((node, index) => ({
    key: node.id,
    node,
    x: startX + (index % cols) * (w + gap),
    y: startY + Math.floor(index / cols) * (h + gap),
    w,
    h,
    back: false
  }));
  if (hasBack) {
    const index = items.length;
    tiles.push({
      key: "back",
      node: null,
      x: startX + (index % cols) * (w + gap),
      y: startY + Math.floor(index / cols) * (h + gap),
      w,
      h,
      back: true
    });
  }
  return tiles;
}

export function MenuD({ menuId, colourMapping, onLeafSelect, onEvent }: MenuProps) {
  const [path, setPath] = useState<TaxonomyNode[]>([]);
  const [busy, setBusy] = useState(false);
  const sceneRef = useRef<SVGGElement>(null);
  const items = path.length === 0 ? DEPARTMENTS : path.length === 1 ? childrenOf(path[0]!.id) : childrenOf(path[1]!.id);
  const tiles = layoutTiles(items, path.length > 0);
  const dept = path.length > 0 ? departmentOf(path[path.length - 1]!.id) : null;
  const colour = dept ? PALETTE[departmentColour(dept.id, colourMapping)] : PALETTE.teal;
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const zoom = (tile: Tile, callback: () => void) => {
    if (busy) return;
    if (reduced || !sceneRef.current) {
      callback();
      return;
    }
    setBusy(true);
    const cx = tile.x + tile.w / 2;
    const cy = tile.y + tile.h / 2;
    const scale = 1.35;
    d3.select(sceneRef.current)
      .transition()
      .duration(180)
      .attr("transform", `translate(${W / 2 - cx * scale}, ${H / 2 - cy * scale}) scale(${scale})`)
      .on("end", () => {
        callback();
        d3.select(sceneRef.current).attr("transform", null);
        setBusy(false);
      });
  };

  const choose = (tile: Tile) => {
    if (busy) return;
    if (tile.back) {
      onEvent("back", { level: path.length });
      setPath(path.slice(0, -1));
      return;
    }
    const node = tile.node;
    if (!node) return;
    if (node.level === 3) {
      onLeafSelect(node);
      return;
    }
    onEvent("node_click", { level: node.level, element_id: node.id, element_label: node.label, parent_id: node.parentId });
    zoom(tile, () => setPath([...path, node]));
  };

  const reset = () => setPath([]);
  const back = () => {
    if (path.length === 0) return;
    onEvent("back", { level: path.length });
    setPath(path.slice(0, -1));
  };

  return (
    <section className="menu-shell menu-d" data-menu-id={menuId} data-testid="menu-d">
      <MenuHeading
        menuId={menuId}
        title="Fractal tiles"
        subtitle="Zoom into a tile, then keep choosing. The grid reorganises at each level."
        path={path}
        onHome={reset}
        onBack={path.length ? back : undefined}
      />
      <div className="d-frame" style={{ borderColor: colour.border }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="d-svg"
          role="group"
          aria-label="Fractal tile menu"
          data-testid="d-svg"
        >
          <defs>
            <pattern id="d-grid" width="36" height="36" patternUnits="userSpaceOnUse">
              <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#e2e8f0" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={W} height={H} fill="url(#d-grid)" />
          <g ref={sceneRef}>
            {tiles.map((tile) => {
              const node = tile.node;
              if (tile.back) {
                return (
                  <g
                    key={tile.key}
                    className="d-tile d-tile-back"
                    role="button"
                    tabIndex={0}
                    aria-label="Back one level"
                    data-testid="d-back"
                    onClick={() => choose(tile)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        choose(tile);
                      }
                    }}
                  >
                    <rect data-hit-target x={tile.x} y={tile.y} width={tile.w} height={tile.h} rx={18} />
                    <text x={tile.x + tile.w / 2} y={tile.y + tile.h / 2 - 6} textAnchor="middle" className="d-back-arrow">
                      â†
                    </text>
                    <text x={tile.x + tile.w / 2} y={tile.y + tile.h / 2 + 28} textAnchor="middle" className="d-back-label">
                      Back
                    </text>
                  </g>
                );
              }
              if (!node) return null;
              const nodeDept = departmentOf(node.id);
              const palette = PALETTE[departmentColour(nodeDept?.id ?? node.id, colourMapping)];
              const isLeaf = node.level === 3;
              return (
                <g
                  key={tile.key}
                  className="d-tile"
                  role="button"
                  tabIndex={0}
                  aria-label={node.label}
                  data-node-id={node.id}
                  onClick={() => choose(tile)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      choose(tile);
                    }
                  }}
                >
                  <rect
                    data-hit-target
                    x={tile.x}
                    y={tile.y}
                    width={tile.w}
                    height={tile.h}
                    rx={18}
                    fill={isLeaf ? palette.soft : palette.bg}
                    stroke={palette.border}
                  />
                  <foreignObject x={tile.x + 22} y={tile.y + 20} width={64} height={64}>
                    <div className={isLeaf ? "d-icon d-icon-soft" : "d-icon"} style={{ color: isLeaf ? palette.bg : "#ffffff" }}>
                      <NodeIcon name={isLeaf ? "Watch" : node.icon} size={34} />
                    </div>
                  </foreignObject>
                  <text
                    x={tile.x + 22}
                    y={tile.y + tile.h - (isLeaf ? 52 : 66)}
                    className={isLeaf ? "d-label d-label-leaf" : "d-label"}
                    fill={isLeaf ? "#0f172a" : "#ffffff"}
                  >
                    {node.label}
                  </text>
                  <text
                    x={tile.x + 22}
                    y={tile.y + tile.h - 28}
                    className="d-sub"
                    fill={isLeaf ? "#475569" : "rgba(255,255,255,0.78)"}
                  >
                    {node.level === 1 ? "Open department" : node.level === 2 ? "6 watches" : "View product"}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        <div className="d-caption">
          <span>Tiles keep the same interaction grammar at every level.</span>
          <span className="d-caption-count">{items.length} choices</span>
        </div>
      </div>
    </section>
  );
}


