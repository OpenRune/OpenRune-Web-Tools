import { ByteBuffer } from "../../io/byte-buffer";

/** A 6-byte entry in an `.idxN` file: how big the archive is and where its first sector lives. */
export class SectorCluster {
    static readonly SIZE = 6;

    static decode(buffer: ByteBuffer): SectorCluster {
        const size = buffer.readMedium();
        const sector = buffer.readMedium();
        return new SectorCluster(size, sector);
    }

    constructor(
        readonly size: number,
        readonly sector: number,
    ) {}
}
