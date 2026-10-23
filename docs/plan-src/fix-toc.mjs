import fs from "node:fs";
const p = "D:/hci project iat/docs/plan-src/00-base.html";
let t = fs.readFileSync(p, "utf8");
t = t.replace(
  /<span class="dots"><\/span><\/a><\/li>/g,
  '<span class="dots"></span><span class="pg"></span></a></li>'
);
fs.writeFileSync(p, t, "utf8");
console.log("pg spans:", (t.match(/<span class="pg"><\/span>/g) || []).length);
