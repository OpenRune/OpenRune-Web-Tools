// Used only in the Next.js *server* webpack build (see next.config.mjs's ProvidePlugin) to stand
// in for `window`/`document`/`navigator`/`self` where @openrune/map-viewer's vendored, CRA-era
// code reads or calls a property off one of them at module scope rather than inside a component
// — code that only ever actually runs in the browser (it's mounted under
// next/dynamic(ssr:false)), but that the server bundle still has to evaluate once just to build
// the module graph. Property access and calls recurse into the same sink rather than throwing,
// so a chain like `navigator.userAgent.includes(...)` resolves instead of crashing partway
// through; `valueOf`/`toString`/`Symbol.toPrimitive` fall back to an empty string so string
// coercion (template literals, `+`) doesn't produce "[object Object]" or throw either.
function makeSink() {
  const target = function stub() {
    return sink;
  };
  const sink = new Proxy(target, {
    get(_target, prop) {
      if (prop === "valueOf" || prop === "toString") return () => "";
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === Symbol.iterator) return function* () {};
      return sink;
    },
    apply() {
      return sink;
    },
  });
  return sink;
}

module.exports = makeSink();
