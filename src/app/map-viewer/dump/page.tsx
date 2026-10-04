import nextDynamic from "next/dynamic";

const MapDumpClient = nextDynamic(
    () => import("./MapDumpClient").then((m) => m.MapDumpClient),
    { ssr: false },
);

export const dynamic = "force-static";

export default function MapDumpPage() {
    return <MapDumpClient />;
}
