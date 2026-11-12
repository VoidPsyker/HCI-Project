import { afterEach, expect, it } from "vitest";
import { nodes, products, validateTaxonomy } from "../src/index";

const nodeReferences = [...nodes];
const originalNodes = structuredClone(nodes);
const productReferences = [...products];
const originalProducts = structuredClone(products);
afterEach(() => {
  nodeReferences.forEach((node, index) => Object.assign(node, originalNodes[index]));
  productReferences.forEach((product, index) => Object.assign(product, originalProducts[index]));
  nodes.splice(0, nodes.length, ...nodeReferences);
  products.splice(0, products.length, ...productReferences);
});

it("validates parent references independently of JSON ordering", () => {
  nodes.reverse();
  expect(validateTaxonomy().errors).toEqual([]);
});
it("rejects a subcategory attached to another subcategory", () => {
  nodes.find(n => n.level === 2)!.parentId = nodes.find(n => n.level === 2 && n.id !== nodes.find(n => n.level === 2)!.id)!.id;
  expect(validateTaxonomy().errors.some(error => error.includes("parent level"))).toBe(true);
});
it("rejects leaf links to a different product", () => {
  nodes.find(n => n.level === 3)!.productId = products[1]!.id;
  expect(validateTaxonomy().errors.some(error => error.includes("productId mismatch"))).toBe(true);
});
it("rejects non-finite product prices", () => {
  products[0]!.price = NaN;
  expect(validateTaxonomy().errors.some(error => error.includes("outside band"))).toBe(true);
});
it("rejects invalid attribute values even when task criteria do not use them", () => {
  products[0]!.attributes.movement = "invalid" as "automatic";
  expect(validateTaxonomy().errors.some(error => error.includes("invalid movement"))).toBe(true);
});
