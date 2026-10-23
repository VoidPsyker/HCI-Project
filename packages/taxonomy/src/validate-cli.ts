import { validateTaxonomy } from "./index";

const report = validateTaxonomy();
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  console.error("Taxonomy validation failed");
  process.exit(1);
}
console.log("Taxonomy validation passed");
