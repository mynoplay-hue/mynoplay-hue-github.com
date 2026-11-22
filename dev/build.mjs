/* Собирает index.html из отдельных частей.

   Запуск:  node dev/build.mjs
   Части лежат в dev/parts/:  head.html, body-*.html, script.js
   Результат — единый статический index.html (GitHub Pages его и отдаёт).
*/
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const partsDir = path.join(root, "dev", "parts");

const read = (p) => readFile(path.join(root, p), "utf8");
const parts = await readdir(partsDir);

const head = await readFile(path.join(partsDir, "head.html"), "utf8");
const bodyOrder = ["header.html", "stats.html", "seed.html", "tabs.html", "syncpanel.html", "footer.html"];

let body = "";
for (const name of bodyOrder) {
  if (!parts.includes(name)) throw new Error(`Нет части ${name}`);
  body += await readFile(path.join(partsDir, name), "utf8");
}

const appScript = await readFile(path.join(partsDir, "app.js"), "utf8");
const syncScript = await read("assets/sync.js");
const dbScript = await read("assets/db.js");

const html = `${head}
<body class="bg-slate-950 text-slate-100 antialiased min-h-screen">
${body}
<script>
${dbScript}
</script>
<script>
${syncScript}
</script>
<script>
${appScript}
</script>
</body>
</html>
`;

await writeFile(path.join(root, "index.html"), html, "utf8");
console.log(`index.html собран: ${(html.length / 1024).toFixed(1)} KB`);
