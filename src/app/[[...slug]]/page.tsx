import nextDynamic from "next/dynamic";

const LegacySpaRoot = nextDynamic(
    () => import("../../components/LegacySpaRoot").then((m) => m.LegacySpaRoot),
    {
        ssr: false,
    },
);

export const dynamic = "force-static";

export function generateStaticParams() {
    return [{ slug: [] }];
}

export default function HomePage() {
    return <LegacySpaRoot />;
}
