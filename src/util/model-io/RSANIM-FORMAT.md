# `.rsanim` — animation pack

Every frame of one animation in a single file, so an animation can be moved around as one thing
instead of fifty loose `.dat`s that have to stay together.

The frame bytes are untouched — each one is exactly what `main_file_cache.idx0` stores. Unpacking
is a loop of `cache.write(0, archive, file, data)`; nothing has to be decoded first.

## Layout

Big-endian throughout, matching the rest of the cache.

| Offset | Type    | Meaning                                           |
| ------ | ------- | ------------------------------------------------- |
| 0      | 4 bytes | Magic, ASCII `RSAN`                               |
| 4      | u8      | Version, currently `1`                            |
| 5      | u16     | Archive id in index 0 that these frames pack into |
| 7      | u16     | Frame count                                       |

Then, per frame:

| Type      | Meaning                                       |
| --------- | --------------------------------------------- |
| u16       | File id within the archive                    |
| u16       | Length of the frame data in bytes             |
| _n_ bytes | The frame, byte-for-byte as index 0 stores it |

Frames are written in playback order and numbered from 0, so file id _i_ is the _i_-th frame.

## Packing it

```kotlin
// dev.openrune.cache.tools.tasks.impl
fun packAnimPack(cache: Cache, file: File) {
    val buf = Unpooled.wrappedBuffer(Files.readAllBytes(file.toPath()))
    require(buf.readCharSequence(4, Charsets.US_ASCII).toString() == "RSAN") { "Not an animation pack" }
    require(buf.readUnsignedByte().toInt() == 1) { "Unsupported pack version" }

    val archive = buf.readUnsignedShort()
    val count = buf.readUnsignedShort()
    repeat(count) {
        val fileId = buf.readUnsignedShort()
        val length = buf.readUnsignedShort()
        val data = ByteArray(length).also { buf.readBytes(it) }
        cache.write(ANIMATIONS, archive, fileId, data)
    }
    buf.release()
}
```

The sequence that plays these frames is a separate file — `config.dat` in the same bundle, or the
`frameIds` list in `anim.toml`, both of which already point at `(archive shl 16) or fileId` for
each frame.

## Notes

-   **Empty frames are not written.** A frame where nothing moves encodes to a couple of bytes that
    tell the client to do nothing; the exporter drops them and numbers what's left consecutively,
    so the `frameIds` in the config match what's actually in the pack.
-   **The archive is chosen at export time** and checked against the open cache, so a pack won't
    quietly overwrite an animation that's already there.
-   A pack is self-contained apart from the rig: each frame names the `SeqBase` it was built
    against, which has to exist in index 1 for the frames to decode.
