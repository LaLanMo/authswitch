import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outfile = path.join(projectRoot, "bundle", "authswitch.js");

await mkdir(path.dirname(outfile), { recursive: true });

await build({
  entryPoints: [path.join(projectRoot, "dist", "src", "cli.js")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "info",
});

const bundled = await readFile(outfile, "utf8");
const normalized = `#!/usr/bin/env node\n${bundled.replace(/^(#![^\n]*\n)+/, "")}`;
await writeFile(outfile, normalized, "utf8");
await chmod(outfile, 0o755);
