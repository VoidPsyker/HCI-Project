import fs from "node:fs";

const p = "D:/hci project iat/docs/plan-src/13-references-appendix.html";
let t = fs.readFileSync(p, "utf8");

const liStart = t.indexOf("    <p>Li, A., &amp; Nielsen");
if (liStart < 0) throw new Error("Li entry not found");
const liEnd = t.indexOf("</p>", liStart) + 4;
const liBlock = t.slice(liStart, liEnd);

t = t.slice(0, liStart) + t.slice(liEnd);
const meh = t.indexOf("    <p>Mehrabian");
if (meh < 0) throw new Error("Mehrabian entry not found");
t = t.slice(0, meh) + liBlock + "\n\n" + t.slice(meh);

// Collapse any accidental triple blank lines.
t = t.replace(/\n{3,}/g, "\n\n");
fs.writeFileSync(p, t, "utf8");
console.log("Li entry moved before Mehrabian");
