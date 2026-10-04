import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    external: ["react", "react-dom"],
    // Everything here draws to a canvas and listens for pointer events, so it can only run in the
    // browser. Without this a Next app-router page importing it fails to build.
    banner: { js: '"use client";' },
});
