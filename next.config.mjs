import { fileURLToPath } from "node:url";

// Next vendors its own webpack rather than exposing it as a normal dependency.
import webpack from "next/dist/compiled/webpack/webpack-lib.js";

const browserGlobalStub = fileURLToPath(
  new URL("./scripts/server-browser-global-stub.js", import.meta.url),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // @openrune/map-viewer is a source-only workspace package (vendored rs-map-viewer code) —
  // Next compiles it directly rather than expecting a pre-built dist, same as app source.
  transpilePackages: ["@openrune/map-viewer"],
  webpack: (config, { isServer }) => {
    // It's pure client-side code (CRA-era, assumes `window`/`document`/`navigator` exist at
    // module load, not just inside components) loaded under the app's existing
    // `next/dynamic(..., { ssr: false })` root. The *server* build still has to successfully
    // bundle and evaluate every module it imports once to build the module graph, even though
    // it'll never actually render it — stub those three globals during that server pass only,
    // so a module-scope `window.foo` read returns `undefined` instead of throwing.
    if (isServer) {
      config.plugins.push(
        new webpack.ProvidePlugin({
          window: browserGlobalStub,
          document: browserGlobalStub,
          navigator: browserGlobalStub,
          self: browserGlobalStub,
        }),
      );
    }

    // rs-map-viewer's shaders are imported as `.glsl`/`.vs`/`.fs` modules exporting their
    // source as a string (matching its own craco.config.js's `ts-shader-loader` rule).
    config.module.rules.unshift({
      test: /\.(glsl|vs|fs)$/,
      loader: "ts-shader-loader",
    });
    config.module.rules.push({ resourceQuery: /url/, type: "asset/resource" });
    config.module.rules.push({ resourceQuery: /source/, type: "asset/source" });

    config.resolve.fallback = { ...config.resolve.fallback, fs: false };

    // @foxglove/wasm-bz2 (legacy bzip2 cache decompression — unused for the dat2 caches this
    // app opens, but still part of the static import graph) ships an Emscripten-style .wasm
    // its own JS glue fetches/instantiates manually — treat it as a raw asset rather than
    // letting webpack try to link it as a WASM ES module (which fails on its "env" imports).
    config.module.rules.push({ test: /\.wasm$/, type: "asset/resource" });

    return config;
  },
  async headers() {
    // The vendored renderer's worker pool uses SharedArrayBuffer for cache bytes, which
    // requires these on every response (not just the map-viewer route, since a SharedArrayBuffer
    // allocated under an uncrossed-origin-isolated page won't work even if only used there).
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
