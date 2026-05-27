import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../data/episodes.json");
const dst = resolve(here, "../public/data/episodes.json");
statSync(src);
mkdirSync(dirname(dst), { recursive: true });
copyFileSync(src, dst);
console.log(`copy-data: ${src} -> ${dst}`);
