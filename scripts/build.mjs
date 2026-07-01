import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const shared = {
  bundle: true,
  minify: false,
  sourcemap: true,
  target: "es2022",
  logLevel: "info"
};

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/entrypoints/background.ts"],
    outfile: "dist/background.js",
    format: "esm"
  }),
  build({
    ...shared,
    entryPoints: ["src/entrypoints/content.ts"],
    outfile: "dist/content.js",
    format: "iife"
  }),
  build({
    ...shared,
    entryPoints: ["src/entrypoints/ozon-page-probe.ts"],
    outfile: "dist/ozon-page-probe.js",
    format: "iife"
  }),
  build({
    ...shared,
    entryPoints: ["src/entrypoints/options.ts"],
    outfile: "dist/options.js",
    format: "iife"
  })
]);

await Promise.all([
  cp("src/assets", "dist/assets", { recursive: true }),
  cp("src/manifest.json", "dist/manifest.json"),
  cp("src/entrypoints/options.html", "dist/options.html")
]);
