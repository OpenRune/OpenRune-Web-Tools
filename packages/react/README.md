# @openrune/react

Drop RuneScape cache content on a page — models, sprites, and whatever is in the binary index.

```tsx
<RSModel id={65533} animation={7570} />
<RSSprite id={498} />
<RSBinary id={814} />
```

## <RSModel>

```tsx
import { RSCacheProvider, RSModel } from "@openrune/react";

<RSCacheProvider cache={cache}>
    <div style={{ width: 400, height: 400 }}>
        <RSModel id={65533} />
        <RSModel id={65533} animation={7570} />
    </div>
</RSCacheProvider>;
```

`<RSModel>` fills its parent, so give the parent a size. Drag to orbit, wheel to zoom — both on
by default. That's the whole of it: no toolbars, no panels, nothing to opt out of.

The cache comes from `@openrune/cache`. A `cache` prop works instead of the provider, and wins
over it.

## Props

|                                 |                                                                        |
| ------------------------------- | ---------------------------------------------------------------------- |
| `id`                            | Model id to read from the cache                                        |
| `model`                         | An already-decoded `RSModelDefinition`, instead of an id               |
| `animation`                     | Sequence id to play on it                                              |
| `sequence`                      | An already-loaded sequence, instead of an id                           |
| `cache`                         | Overrides the provider's cache                                         |
| `autoPlay`                      | Plays as soon as an animation loads (default true)                     |
| `loop`                          | Starts over at the end (default true)                                  |
| `controls`                      | Orbit and zoom (default true)                                          |
| `camera`                        | `{ yaw, pitch, zoom }`, any subset                                     |
| `render`                        | `{ renderMode, useColors, showGrid }` — `solid`, `wireframe` or `both` |
| `className`, `style`            | On the wrapper                                                         |
| `fallback`                      | Shown while decoding                                                   |
| `errorFallback`                 | `(error) => node`, shown instead of the canvas                         |
| `onReady`, `onError`, `onFrame` |                                                                        |

## Driving it yourself

Turn the built-in controls off and take a ref:

```tsx
const model = useRef<RSModelHandle>(null);

<RSModel ref={model} id={65533} animation={7570} autoPlay={false} controls={false} />

<button onClick={() => model.current?.toggle()}>play / pause</button>
<button onClick={() => model.current?.step(1)}>next frame</button>
<input
    type="range"
    max={model.current?.length ?? 0}
    onChange={(e) => model.current?.seek(+e.target.value)}
/>
```

The handle has `play`, `pause`, `toggle`, `seek`, `step`, `playing`, `frame`, `length`,
`getCamera`, `setCamera`, `resetCamera`, `setRenderOptions`, and the `canvas` itself.

Spinning it your own way:

```tsx
useEffect(() => {
    let raf = 0;
    const spin = () => {
        const camera = model.current?.getCamera();
        if (camera) model.current?.setCamera({ yaw: camera.yaw + 0.01 });
        raf = requestAnimationFrame(spin);
    };
    raf = requestAnimationFrame(spin);
    return () => cancelAnimationFrame(raf);
}, []);
```

## Without React

`RSModelScene` is the whole thing with no React in it — same methods, plus `observe(element)` to
keep the canvas sized, and `dispose()`:

```ts
import { RSModelScene, loadModel, loadSequence } from "@openrune/react";

const scene = new RSModelScene(canvas);
scene.setModel(loadModel(cache, 65533));
scene.setSequence(loadSequence(cache, 7570));
scene.play();
```

## Notes

-   Each scene owns a WebGL2 context. Browsers cap how many can be live at once (often around 16),
    so unmount the ones you aren't looking at rather than keeping a hundred on a page.
-   Animation advances on wall-clock time at the client's 20ms tick, so a dropped browser frame
    doesn't slow the movement down.
-   Both animation kinds work: old-style frame lists and skeletal (Maya) sequences.
-   Textured faces render untextured — the texture index isn't decoded yet.

## `<RSSprite>`

```tsx
<RSSprite id={498} />                 // first frame, actual pixel size
<RSSprite id={498} frame={2} scale={4} />
<RSSprite id={498} frame="all" />     // every frame side by side
```

Sizes itself to the sprite rather than filling its parent — a sprite has a real pixel size, and
stretching it to a box would only blur it. `scale` makes it bigger; `pixelated` (on by default)
keeps it crisp when it is.

|              |                                                       |
| ------------ | ----------------------------------------------------- |
| `id`         | Sprite archive id                                     |
| `frames`     | Already-decoded frames, instead of an id              |
| `frame`      | Frame number, or `"all"` for the strip. Defaults to 0 |
| `scale`      | Multiple of the sprite's own size (default 1)         |
| `pixelated`  | Crisp pixels when scaled (default true)               |
| `background` | `"checkerboard"`, a CSS colour, or `"none"` (default) |
| `alt`        | Accessible name                                       |
| `onReady`    | `{ width, height, frameCount }`                       |

Animating a sheet is `frame` plus your own timer — `onReady` tells you how many there are.

## `<RSBinary>`

```tsx
<RSBinary id={814} />
```

The binary index is a grab-bag — login-screen backgrounds, the huffman chat table, whatever a
server has added — so there's nothing but the bytes to go on. JPEG, PNG, GIF and WebP are shown
as pictures; anything else falls to `renderUnknown`, which defaults to the first 64 bytes as hex.

```tsx
<RSBinary
    id={3}
    renderUnknown={({ length, hex }) => (
        <code>
            {length} bytes: {hex}
        </code>
    )}
/>
```

|                 |                                                  |
| --------------- | ------------------------------------------------ |
| `id`            | Archive id in the binary index                   |
| `file`          | File within it (default 0 — nearly all hold one) |
| `bytes`         | Bytes you already have, instead of an id         |
| `renderUnknown` | `({ bytes, length, hex }) => node`               |
| `onReady`       | `{ kind, length, bytes }`                        |

Object URLs are created and revoked for you as the archive changes.

## Loaders

The decoding behind all three, as plain functions:

```ts
loadModel(cache, id); // RSModelDefinition
loadSequence(cache, id); // old-style or skeletal, whichever it is
loadSprite(cache, id); // IndexedSprite[]
spriteToRgba(frames, "all"); // { width, height, rgba }
loadBinary(cache, id); // Uint8Array
sniffBinary(bytes); // "jpeg" | "png" | "gif" | "webp" | "unknown"
```
