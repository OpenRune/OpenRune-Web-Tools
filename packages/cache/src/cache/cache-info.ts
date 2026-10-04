export type GameType = "classic" | "runescape" | "oldschool";

export type CacheInfo = {
    name: string;
    game: GameType;
    environment: string;
    revision: number;
    timestamp: string;
    size: number;
};
