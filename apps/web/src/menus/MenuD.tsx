import { useRef, useState } from "react";
import * as d3 from "d3";
import {
  DEPARTMENTS,
  PALETTE,
  childrenOf,
  departmentColour,
  departmentOf,
  type TaxonomyNode
} from "@meridian/taxonomy";
import type { MenuProps } from "../types";
import { NodeIcon } from "../components/Icon";
import { MenuHeading, createMenuLog, useInert, useMenuOpened } from "../components/MenuChrome";
import { useBrowserBack, type BackSource } from "./browserBack";

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

export function MenuD({ menuId, colourMapping, onLeafSelect, onEvent, disabled = false }: MenuProps) {
  const [path, setPath] = useState<TaxonomyNode[]>([]);
  const [busy, setBusy] = useState(false);
  const shellRef = useInert<HTMLElement>(disabled);
  const sceneRef = useRef<SVGGElement>(null);
  const items = path.length === 0 ? DEPARTMENTS : path.length === 1 ? childrenOf(path[0]!.id) : childrenOf(path[1]!.id);
  const tiles = layoutTiles(items, path.length > 0);
  const dept = path.length > 0 ? departmentOf(path[path.length - 1]!.id) : null;
  const colour = dept ? PALETTE[departmentColour(dept.id, colourMapping)] : PALETTE.teal;
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const visibleOptions = items.length;
  const log = createMenuLog(onEvent, visibleOptions, disabled);
  useMenuOpened(log);

  const back = (source: BackSource = "control") => {
    if (disabled) return;
    if (path.length === 0) {
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

  const choose = (tile: Tile, inputType: "keyboard" | "mouse") => {
    if (disabled || busy) return;
    if (tile.back) {
      back("control");
      return;
    }
    const node = tile.node;
    if (!node) return;
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
    zoom(tile, () => setPath([...path, node]));
  };

  const reset = () => {
    if (disabled) return;
    setPath([]);
  };

  return (
    <section
      ref={shellRef}
      className="menu-shell menu-d"
      data-menu-id={menuId}
      data-testid="menu-d"
      data-aoi="menu"
      aria-disabled={disabled || undefined}
    >
      <MenuHeading
        menuId={menuId}
        title="Fractal tiles"
        subtitle="Zoom into a tile, then keep choosing. The grid reorganises at each level."
        path={path}
        onHome={reset}
        onBack={path.length ? () => back("control") : undefined}
        breadcrumb="always"
        onEvent={onEvent}
        visibleOptions={visibleOptions}
        disabled={disabled}
      />
      <div className="d-frame" style={{ borderColor: colour.border }} data-aoi="tile-grid">
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
                    onClick={() => choose(tile, "mouse")}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        choose(tile, "keyboard");
                      }
                    }}
                  >
                    <rect data-hit-target x={tile.x} y={tile.y} width={tile.w} height={tile.h} rx={18} />
                    <text x={tile.x + tile.w / 2} y={tile.y + tile.h / 2 - 6} textAnchor="middle" className="d-back-arrow">
                      {"\u2190"}
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
              const sublabel = node.level === 1 ? "Open department" : node.level === 2 ? "6 watches" : "View product";
              return (
                <g
                  key={tile.key}
                  className="d-tile"
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.label} ${sublabel}`}
                  data-node-id={node.id}
                  data-aoi-level={node.level}
                  onClick={() => choose(tile, "mouse")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      choose(tile, "keyboard");
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
                    {`${node.label} `}
                  </text>
                  <text
                    x={tile.x + 22}
                    y={tile.y + tile.h - 28}
                    className="d-sub"
                    fill={isLeaf ? "#475569" : "#ffffff"}
                  >
                    {sublabel}
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
