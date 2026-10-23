import fs from "node:fs";
import path from "node:path";

const dir = "D:/hci project iat/docs/plan-src";
const order = [
  "01-exec.html",
  "02-background.html",
  "03-questions-emotions.html",
  "04-menus.html",
  "05-platform-design.html",
  "06-pilot-study1.html",
  "07-study2-study3.html",
  "08-measures-analysis.html",
  "09-power.html",
  "10-implementation.html",
  "11-ethics-validity.html",
  "12-timeline-paper.html",
  "13-references-appendix.html",
];

const base = fs.readFileSync(path.join(dir, "00-base.html"), "utf8");
const body = order.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
const tocPages = JSON.parse(fs.readFileSync(path.join(dir, "toc-pages.json"), "utf8"));

let out = base.replace("<!-- APPEND_MARKER -->", body);
let injected = 0;
out = out.replace(
  /<li><a href="#([^"]+)">([\s\S]*?)<span class="pg"><\/span><\/a><\/li>/g,
  (match, id, inner) => {
    const page = tocPages[id];
    if (!page) return match;
    injected++;
    return `<li><a href="#${id}">${inner}<span class="pg">${page}</span></a></li>`;
  }
);

fs.writeFileSync(path.join(dir, "combined.html"), out, "utf8");
console.log("combined.html written:", out.length, "chars");
console.log("TOC page numbers injected:", injected);
console.log("sections:", (out.match(/<section class="section"/g) || []).length);
