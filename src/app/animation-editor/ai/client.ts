import Anthropic from "@anthropic-ai/sdk";

import { AI_SYSTEM_PROMPT, type SceneFacts, describeScene } from "./context";
import { AI_TOOLS, type PlannedAction, describeAction } from "./tools";

const KEY_STORAGE = "openrune.animation-editor.anthropic-key";
const WORKSPACE_STORAGE = "openrune.animation-editor.anthropic-workspace";
const MODEL_STORAGE = "openrune.animation-editor.anthropic-model";

/**
 * The models worth offering, cheapest last.
 *
 * Which one to use is a real choice here rather than a setting to ignore. Working out which of
 * eight unnamed labels is the tail is a judgement call that Opus is markedly better at; giving
 * every label a rotate movement is not, and paying Opus rates for it is waste.
 */
export const AI_MODELS = [
    {
        id: "claude-opus-5",
        label: "Opus 5",
        note: "Best at reading a rig — which label is the tail, what a part is for",
        /** Dollars per million tokens. */
        inputPrice: 5,
        outputPrice: 25,
    },
    {
        id: "claude-sonnet-5",
        label: "Sonnet 5",
        note: "Good middle ground for everyday rigging and keying",
        inputPrice: 2,
        outputPrice: 10,
    },
    {
        id: "claude-haiku-4-5",
        label: "Haiku 4.5",
        note: "Cheapest — fine for mechanical work you've already described exactly",
        inputPrice: 1,
        outputPrice: 5,
    },
] as const;

/** What a turn cost, in dollars. Cached input is a tenth of the price; fresh writes are more. */
export function turnCost(model: AiModelId, usage: TokenUsage): number {
    const rates = AI_MODELS.find((m) => m.id === model) ?? AI_MODELS[0];
    return (
        ((usage.input + usage.cacheWrite * 1.25 + usage.cacheRead * 0.1) * rates.inputPrice +
            usage.output * rates.outputPrice) /
        1_000_000
    );
}

export type TokenUsage = {
    /** Fresh input tokens, billed at full price. */
    input: number;
    output: number;
    /** Read back from the cache at a tenth of the price. */
    cacheRead: number;
    /** Written to the cache, which costs a little more than fresh input. */
    cacheWrite: number;
};

export const NO_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
    return {
        input: a.input + b.input,
        output: a.output + b.output,
        cacheRead: a.cacheRead + b.cacheRead,
        cacheWrite: a.cacheWrite + b.cacheWrite,
    };
}

export type AiModelId = (typeof AI_MODELS)[number]["id"];

export const DEFAULT_AI_MODEL: AiModelId = "claude-opus-5";

/**
 * Who to tell when the key, workspace or model changes.
 *
 * These settings live in two places at once — the settings modal and the assistant panel — and
 * the only thing worse than one of them being stale is not knowing which one is. Saving goes
 * through here, so anything showing them redraws.
 */
const credentialListeners = new Set<() => void>();

export function subscribeCredentials(listener: () => void): () => void {
    credentialListeners.add(listener);
    return () => {
        credentialListeners.delete(listener);
    };
}

function credentialsChanged(): void {
    for (const listener of credentialListeners) listener();
}

export function loadModel(): AiModelId {
    try {
        const saved = window.localStorage.getItem(MODEL_STORAGE);
        if (AI_MODELS.some((model) => model.id === saved)) return saved as AiModelId;
    } catch {
        // Fall through to the default.
    }
    return DEFAULT_AI_MODEL;
}

export function saveModel(id: AiModelId): void {
    try {
        window.localStorage.setItem(MODEL_STORAGE, id);
    } catch {
        // Private mode or a full quota; it still works for this session.
    }
    credentialsChanged();
}

/**
 * How each model wants its thinking configured.
 *
 * Not one shape for all of them: Opus 5 and Sonnet 5 take adaptive thinking and reject a token
 * budget outright, while Haiku 4.5 is the other way round. Sending the wrong one is a 400, not a
 * silently ignored field.
 */
function thinkingFor(model: AiModelId): Anthropic.ThinkingConfigParam {
    return model === "claude-haiku-4-5"
        ? { type: "enabled", budget_tokens: 2000 }
        : { type: "adaptive" };
}

/** CometAPI proxies the Anthropic Messages API as-is; only the base URL differs. */
const COMET_API_BASE_URL = "https://api.cometapi.com";

/**
 * A direct Anthropic key starts `sk-ant-`; a CometAPI key doesn't, so the prefix alone is enough
 * to route the request without asking which service the key is for.
 */
function isCometApiKey(apiKey: string): boolean {
    return apiKey.trim() !== "" && !apiKey.startsWith("sk-ant-");
}

/**
 * Bring your own key.
 *
 * Kept in this browser only. The editor has no server to hold it on your behalf, and sending it
 * to one would make this a thing you have to trust rather than a thing you run. Accepts a
 * CometAPI key in place of a direct Anthropic one — CometAPI proxies the same Messages API, so
 * only the request's base URL changes, decided by the key's shape in `isCometApiKey`.
 */
export function loadApiKey(): string {
    try {
        return window.localStorage.getItem(KEY_STORAGE) ?? "";
    } catch {
        return "";
    }
}

export function saveApiKey(key: string): void {
    try {
        if (key) window.localStorage.setItem(KEY_STORAGE, key);
        else window.localStorage.removeItem(KEY_STORAGE);
    } catch {
        // Private mode or a full quota; the key still works for this session.
    }
    credentialsChanged();
}

/**
 * The workspace a key belongs to, when it doesn't belong to one by itself.
 *
 * Console keys can be scoped to a workspace or not. An unscoped one has to say which workspace
 * each request is for, and the API rejects it outright otherwise — so this is optional here and
 * only sent when it's set.
 */
export function loadWorkspaceId(): string {
    try {
        return window.localStorage.getItem(WORKSPACE_STORAGE) ?? "";
    } catch {
        return "";
    }
}

export function saveWorkspaceId(id: string): void {
    try {
        if (id) window.localStorage.setItem(WORKSPACE_STORAGE, id);
        else window.localStorage.removeItem(WORKSPACE_STORAGE);
    } catch {
        // Private mode or a full quota; it still works for this session.
    }
    credentialsChanged();
}

/**
 * Turns an API error into something you can act on.
 *
 * The raw 400s are accurate but say nothing about where the fix lives, and two of them come up
 * often enough to be worth naming: an unscoped key, and a Console account with no credit — which
 * a Claude subscription does not top up, because the API bills separately.
 */
export function explainApiError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("anthropic-workspace-id")) {
        return "This key isn't tied to a workspace, so it needs one naming. Put your workspace id in the field under the key — it's in the Console URL when you open a workspace, starting wrkspc_.";
    }
    if (message.includes("credit balance")) {
        return "That account has no API credit. A Claude Pro or Max subscription covers claude.ai and Claude Code, but the API is billed separately — add credit under Plans & Billing in the Console, or top up your CometAPI balance.";
    }
    if (message.includes("authentication_error") || message.includes("invalid x-api-key")) {
        return "That key was rejected. Check it was copied whole — either an Anthropic Console key (starting sk-ant-) or a CometAPI key, not a session token.";
    }
    if (message.includes("rate_limit")) {
        return "Rate limited. Wait a moment and try again.";
    }
    return message;
}

export type AiTurn = {
    /** What it said, if anything. */
    text: string;
    /** What it wants to do, for approval. */
    plan: PlannedAction[];
    /** What the turn cost, in tokens. */
    usage: TokenUsage;
    /** Which model answered, so a running total can price mixed turns correctly. */
    model: AiModelId;
};

function makeClient(apiKey: string, workspaceId?: string): Anthropic {
    return new Anthropic({
        apiKey,
        // The editor runs entirely in the page; there's no server to proxy through.
        dangerouslyAllowBrowser: true,
        baseURL: isCometApiKey(apiKey) ? COMET_API_BASE_URL : undefined,
        defaultHeaders: workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined,
    });
}

function imageBlock(screenshot: {
    mediaType: "image/png";
    base64: string;
}): Anthropic.ImageBlockParam {
    return {
        type: "image",
        source: { type: "base64", media_type: screenshot.mediaType, data: screenshot.base64 },
    };
}

/** Sends an already-built message list and parses the reply. Shared by a fresh ask and a continuation. */
async function runTurn(
    client: Anthropic,
    model: AiModelId,
    messages: Anthropic.MessageParam[],
    signal: AbortSignal | undefined,
): Promise<{ turn: AiTurn; messages: Anthropic.MessageParam[] }> {
    const response = await client.messages.create(
        {
            model,
            max_tokens: 8000,
            thinking: thinkingFor(model),
            system: AI_SYSTEM_PROMPT,
            tools: AI_TOOLS,
            messages,
        },
        { signal },
    );

    const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

    const plan: PlannedAction[] = response.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
        .map((block) => {
            const input = (block.input ?? {}) as Record<string, unknown>;
            return {
                id: block.id,
                name: block.name,
                input,
                summary: describeAction(block.name, input),
            };
        });

    return {
        turn: {
            text,
            plan,
            model,
            usage: {
                input: response.usage.input_tokens,
                output: response.usage.output_tokens,
                cacheRead: response.usage.cache_read_input_tokens ?? 0,
                cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
            },
        },
        messages: [...messages, { role: "assistant", content: response.content }],
    };
}

/**
 * One turn: the scene as it stands, the request, and whatever it proposes doing about it.
 *
 * Nothing is executed here. The tool calls come back as a plan to be shown and approved, because
 * an assistant that rewrites a rig the moment you hit enter is one you'd stop using after the
 * first time it misread which label was the tail.
 */
export async function askAssistant({
    apiKey,
    workspaceId,
    model,
    scene,
    screenshot,
    prompt,
    history,
    signal,
}: {
    apiKey: string;
    /** Only needed for a key that isn't scoped to one workspace. */
    workspaceId?: string;
    model: AiModelId;
    scene: SceneFacts;
    /** A snapshot of the current 3D view, when the editor could produce one. */
    screenshot: { mediaType: "image/png"; base64: string } | null;
    prompt: string;
    /** Earlier turns, so follow-ups like "now make it slower" have something to refer to. */
    history: Anthropic.MessageParam[];
    /** Lets the Stop button cut the request short instead of waiting it out. */
    signal?: AbortSignal;
}): Promise<{ turn: AiTurn; messages: Anthropic.MessageParam[] }> {
    const promptText = `Here is the scene as it stands.\n\n${describeScene(
        scene,
    )}\n\n---\n\n${prompt}`;
    const messages: Anthropic.MessageParam[] = [
        ...history,
        {
            role: "user",
            content: screenshot
                ? [imageBlock(screenshot), { type: "text", text: promptText }]
                : promptText,
        },
    ];

    return runTurn(makeClient(apiKey, workspaceId), model, messages, signal);
}

/**
 * Continues straight from an applied plan's tool results, with no human prompt in between.
 *
 * The API won't accept two `user` turns in a row, so this can't just call `askAssistant` again —
 * instead it folds fresh scene context and a nudge onto the *same* tool-result turn `toolResults`
 * built, as extra content blocks, so it still reads as one ordinary user turn followed by the
 * model's reply. Used right after applying a plan that leaves something worth finishing without
 * being asked — today, that's `split_label` handing back ids nobody has named yet.
 */
export async function continueAfterTools({
    apiKey,
    workspaceId,
    model,
    scene,
    screenshot,
    nudge,
    history,
    signal,
}: {
    apiKey: string;
    workspaceId?: string;
    model: AiModelId;
    scene: SceneFacts;
    screenshot: { mediaType: "image/png"; base64: string } | null;
    /** What it should do now, appended after the fresh scene facts. */
    nudge: string;
    /** Must end in the `tool_result` user message `toolResults` produced. */
    history: Anthropic.MessageParam[];
    signal?: AbortSignal;
}): Promise<{ turn: AiTurn; messages: Anthropic.MessageParam[] }> {
    const last = history[history.length - 1];
    const priorBlocks: Anthropic.ContentBlockParam[] = Array.isArray(last?.content)
        ? last.content
        : [{ type: "text", text: String(last?.content ?? "") }];
    const text = `${describeScene(scene)}\n\n---\n\n${nudge}`;
    const merged: Anthropic.MessageParam = {
        role: "user",
        content: [
            ...priorBlocks,
            ...(screenshot ? [imageBlock(screenshot)] : []),
            { type: "text", text },
        ],
    };

    return runTurn(
        makeClient(apiKey, workspaceId),
        model,
        [...history.slice(0, -1), merged],
        signal,
    );
}

/**
 * Closes the loop after a plan runs.
 *
 * The API expects a `tool_result` for every `tool_use` in the previous turn, so the next thing
 * sent has to answer all of them — otherwise the conversation can't continue and a follow-up
 * like "that's too fast, halve it" has nothing to build on.
 */
export function toolResults(
    plan: PlannedAction[],
    problems: Map<string, string>,
    notes: Map<string, string>,
): Anthropic.MessageParam {
    return {
        role: "user",
        content: plan.map((action) => {
            const problem = problems.get(action.id);
            return {
                type: "tool_result" as const,
                tool_use_id: action.id,
                content: problem ?? notes.get(action.id) ?? "Done.",
                is_error: problem !== undefined,
            };
        }),
    };
}
