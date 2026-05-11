import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(here, "../.."));

await import("../../scripts/dev-server.mjs");
