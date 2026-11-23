import { mkdir, readdir, rm, cp, stat } from "node:fs/promises";
import { join } from "node:path";
const source = new URL("../public/", import.meta.url).pathname;
const dest = new URL("../dist/", import.meta.url).pathname;
await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
for (const file of await readdir(source)) {
  await cp(join(source, file), join(dest, file), { recursive: true });
}
if (!(await stat(join(dest,"index.html"))).isFile()) throw new Error("Missing index.html");
console.log("STATIC FILEPORT public assets built to dist/; secrets and server source excluded.");
