import { useEffect, useId, useRef, type ReactNode } from "react";
import { Search } from "lucide-react";
import type { MenuId, TaxonomyNode } from "@meridian/taxonomy";
import { PRODUCT_BY_ID, PALETTE, departmentColour, NODE_BY_ID } from "@meridian/taxonomy";
import { WatchSVG } from "./WatchSVG";

export const MENU_NAMES: Record<MenuId, string> = {
  A: "Horizontal bar",
  B: "Vertical sidebar",
  C: "Mega menu",
  D: "Fractal tiles",
  E: "Icon grid",
  F: "Radial lattice"
};

export const SEARCH_UNAVAILABLE_MESSAGE = "Search is unavailable in this session.";

export type MenuLog = (type: string, payload?: Record<string, unknown>) => void;

export type BreadcrumbMode = "always" | "after-selection" | "compact" | "hidden";

export function withVisibleOptions(
  payload: Record<string, unknown> | undefined,
  visibleOptions: number
): Record<string, unknown> {
  const meta = (payload?.meta ?? {}) as Record<string, unknown>;
  return { ...(payload ?? {}), meta: { visible_options: visibleOptions, ...meta } };
}

/**
 * Every menu event carries the breadth of the step it belongs to. Payload
 * meta can override the count when an event describes the state being opened.
 */
export function createMenuLog(
  onEvent: (type: string, payload?: Record<string, unknown>) => void,
  visibleOptions: number,
  disabled = false
): MenuLog {
  return (type, payload) => {
    if (disabled) return;
    onEvent(type, withVisibleOptions(payload, visibleOptions));
  };
}

/** Native buttons and Radix items report detail 0 when activated from the keyboard. */
export function inputTypeFor(event: { detail?: number }): "keyboard" | "mouse" {
  return event.detail === 0 ? "keyboard" : "mouse";
}

/** Remove a finished menu from the tab order and pointer surface without hiding it. */
export function useInert<T extends HTMLElement>(disabled: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (disabled) element.setAttribute("inert", "");
    else element.removeAttribute("inert");
  }, [disabled]);
  return ref;
}

/** Log the root step once per mounted menu, so breadth exists before the first click. */
export function useMenuOpened(log: MenuLog, stage = "root"): void {
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    log("menu_open", { level: 0, meta: { stage, initial: true } });
    // The mount event describes the initial state only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function Breadcrumb({
  path,
  onHome,
  onBack,
  compact = false,
  disabled = false
}: {
  path: TaxonomyNode[];
  onHome?: () => void;
  onBack?: () => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <nav className={compact ? "breadcrumb breadcrumb-compact" : "breadcrumb"} aria-label="Current category path">
      <button
        type="button"
        className="crumb-link crumb-root"
        onClick={onHome}
        disabled={!onHome || disabled}
        data-node-id="root"
        aria-label="Meridian home"
      >
        Home
      </button>
      {path.map((node, index) => (
        <span key={node.id} className="crumb-group">
          <span className="crumb-sep" aria-hidden="true">
            /
          </span>
          <span className={index === path.length - 1 ? "crumb crumb-current" : "crumb"}>{node.label}</span>
        </span>
      ))}
      {path.length > 0 && onBack ? (
        <button type="button" className="back-link" onClick={onBack} disabled={disabled}>
          {"\u2190"} Back
        </button>
      ) : null}
    </nav>
  );
}

function SearchControl({
  onEvent,
  visibleOptions,
  disabled = false
}: {
  onEvent: (type: string, payload?: Record<string, unknown>) => void;
  visibleOptions: number;
  disabled?: boolean;
}) {
  const noteId = useId();
  const attempt = (keyboard: boolean) => {
    if (disabled) return;
    onEvent(
      "search_attempt",
      withVisibleOptions(
        {
          level: 0,
          element_id: "search",
          element_label: "Search",
          input_type: keyboard ? "keyboard" : "mouse",
          meta: { message: SEARCH_UNAVAILABLE_MESSAGE }
        },
        visibleOptions
      )
    );
  };

  return (
    <div className="menu-search">
      <button
        type="button"
        className="menu-search-button"
        data-node-id="search"
        data-testid="menu-search"
        aria-disabled="true"
        aria-describedby={noteId}
        onClick={(event) => attempt(event.detail === 0)}
      >
        <Search size={18} strokeWidth={1.8} aria-hidden="true" />
        <span>Search</span>
      </button>
      <p className="menu-search-note" id={noteId}>
        {SEARCH_UNAVAILABLE_MESSAGE}
      </p>
    </div>
  );
}

export function MenuHeading({
  menuId,
  title,
  subtitle,
  path,
  onHome,
  onBack,
  right,
  breadcrumb = "after-selection",
  onEvent,
  visibleOptions,
  disabled = false
}: {
  menuId: MenuId;
  title: string;
  subtitle?: string;
  path: TaxonomyNode[];
  onHome?: () => void;
  onBack?: () => void;
  right?: ReactNode;
  breadcrumb?: BreadcrumbMode;
  onEvent: (type: string, payload?: Record<string, unknown>) => void;
  visibleOptions: number;
  disabled?: boolean;
}) {
  const showBreadcrumb =
    breadcrumb === "always" || breadcrumb === "compact" || (breadcrumb === "after-selection" && path.length > 0);

  return (
    <header className="menu-heading" data-aoi="menu-heading">
      <div className="menu-heading-main">
        <div className="eyebrow">
          Menu {menuId} · {MENU_NAMES[menuId]}
        </div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="menu-heading-side">
        {showBreadcrumb ? (
          <Breadcrumb
            path={path}
            onHome={onHome}
            onBack={onBack}
            compact={breadcrumb === "compact"}
            disabled={disabled}
          />
        ) : null}
        <SearchControl onEvent={onEvent} visibleOptions={visibleOptions} disabled={disabled} />
        {right}
      </div>
    </header>
  );
}

export function ProductDetail({
  productId,
  onBack,
  onNext,
  nextLabel = "Continue",
  correct = true,
  allowBack = true
}: {
  productId: string;
  onBack: () => void;
  onNext?: () => void;
  nextLabel?: string;
  correct?: boolean;
  allowBack?: boolean;
}) {
  const product = PRODUCT_BY_ID.get(productId);
  if (!product) return null;
  const colour = PALETTE[departmentColour(product.departmentId)];
  return (
    <section className="product-detail" data-testid="product-detail" data-product-id={product.id}>
      <div className="product-visual" style={{ background: colour.soft }}>
        <WatchSVG product={product} size={340} />
      </div>
      <div className="product-copy">
        <div className="product-kicker">
          {correct ? "Product found" : "This is not the target product"}
        </div>
        <h2>{NODE_BY_ID.get(product.leafId)?.label ?? product.id}</h2>
        <p className="product-desc">{product.description}</p>
        <dl className="spec-list">
          <div>
            <dt>Reference</dt>
            <dd>{product.id}</dd>
          </div>
          <div>
            <dt>Case</dt>
            <dd>{product.attributes.caseSize} mm</dd>
          </div>
          <div>
            <dt>Strap</dt>
            <dd>{product.attributes.strap}</dd>
          </div>
          <div>
            <dt>Movement</dt>
            <dd>{product.attributes.movement}</dd>
          </div>
          <div>
            <dt>Water resistance</dt>
            <dd>{product.attributes.water} m</dd>
          </div>
          <div>
            <dt>Dial</dt>
            <dd>{product.attributes.dial}</dd>
          </div>
        </dl>
        <div className="product-price">£{product.price.toLocaleString("en-GB")}</div>
        <div className="product-actions">
          {allowBack ? (
            <button type="button" className="button secondary" onClick={onBack}>
              ← Back to menu
            </button>
          ) : null}
          {onNext ? (
            <button type="button" className="button primary" onClick={onNext}>
              {nextLabel}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
