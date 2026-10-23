import type { ReactNode } from "react";
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

export function Breadcrumb({
  path,
  onHome,
  onBack
}: {
  path: TaxonomyNode[];
  onHome?: () => void;
  onBack?: () => void;
}) {
  return (
    <nav className="breadcrumb" aria-label="Current category path">
      <button type="button" className="crumb-link" onClick={onHome} disabled={!onHome}>
        Meridian
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
        <button type="button" className="back-link" onClick={onBack}>
          ← Back
        </button>
      ) : null}
    </nav>
  );
}

export function MenuHeading({
  menuId,
  title,
  subtitle,
  path,
  onHome,
  onBack,
  right
}: {
  menuId: MenuId;
  title: string;
  subtitle?: string;
  path: TaxonomyNode[];
  onHome?: () => void;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <header className="menu-heading">
      <div className="menu-heading-main">
        <div className="eyebrow">
          Menu {menuId} · {MENU_NAMES[menuId]}
        </div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="menu-heading-side">
        <Breadcrumb path={path} onHome={onHome} onBack={onBack} />
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
