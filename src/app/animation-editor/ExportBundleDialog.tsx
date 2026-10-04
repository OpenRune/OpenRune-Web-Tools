"use client";

import { AlertTriangle, Check, Download } from "lucide-react";
import React, { useEffect, useState } from "react";

import { Button } from "../../components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "../../components/ui/dialog";
import { cn } from "../../util/cn";
import { downloadBlob } from "../../util/model-io";
import {
    type BundlePart,
    type BundlePlan,
    type PackTarget,
    buildBundle,
} from "../../util/model-io/seq-bundle";

function size(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function PackTo({ target }: { target: PackTarget | null }): JSX.Element {
    if (!target) return <span className="text-muted-foreground">not a cache file</span>;
    return (
        <>
            <span className="font-mono text-[#e87d0d]">idx{target.index}</span>
            <span className="text-muted-foreground">
                {" "}
                · archive {target.archive}
                {target.file !== null ? ` · file ${target.file}` : " · file ?"}
            </span>
            <span className="block text-[10px] text-muted-foreground">
                the {target.indexName} index
            </span>
        </>
    );
}

/**
 * Pick what goes in the export, then download it.
 *
 * The packing instructions are the real content here: a `.dat` on its own says nothing about
 * where it belongs, and getting the index wrong is the easiest way to break a cache. Parts that
 * haven't changed are listed but left unticked, rather than hidden — re-packing an untouched
 * model is usually pointless, but "usually" isn't "never".
 */
export function ExportBundleDialog({
    plan,
    onClose,
    onRetarget,
}: {
    plan: BundlePlan | null;
    onClose: () => void;
    /** Re-plans against a different frame archive, so the conflict check follows the number. */
    onRetarget: (archive: number) => void;
}): JSX.Element {
    const [chosen, setChosen] = useState<Set<BundlePart>>(new Set());

    // A fresh plan means a fresh set of ticks — whatever had changed at the moment you asked.
    useEffect(() => {
        if (plan) setChosen(new Set(plan.candidates.filter((c) => c.ticked).map((c) => c.id)));
    }, [plan]);

    const toggle = (id: BundlePart): void => {
        setChosen((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const picked = plan?.candidates.filter((c) => chosen.has(c.id)) ?? [];
    const totalBytes = picked.reduce((total, c) => total + c.bytes, 0);
    const fileCount = picked.reduce((total, c) => total + c.files.length, 0);
    const onlyModel = picked.length === 1 && picked[0].id === "model";

    return (
        <Dialog open={plan !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
            <DialogContent
                data-testid="export-bundle-dialog"
                className="w-[620px] max-w-[92vw] gap-0 p-0"
            >
                <DialogHeader className="space-y-0.5 border-b border-border px-4 py-3 text-left">
                    <DialogTitle className="text-sm">Export to cache</DialogTitle>
                    <DialogDescription className="text-xs">
                        Pick what to include. Everything that&apos;s changed is ticked already.
                    </DialogDescription>
                </DialogHeader>

                <div className="max-h-[55vh] min-h-0 overflow-y-auto p-4">
                    {/* Frames pack as an archive of consecutive files, so what has to be free is
                        the archive. Checked as you type rather than on the way out. */}
                    {plan?.frameTarget ? (
                        <div className="mb-3 flex items-center gap-2 rounded border border-border/60 bg-background p-2 text-xs">
                            <span className="shrink-0 text-muted-foreground">frame archive</span>
                            <input
                                type="number"
                                min={0}
                                max={65535}
                                value={plan.frameTarget.archive}
                                aria-label="Frame archive id"
                                onChange={(e) => {
                                    const value = Number.parseInt(e.target.value, 10);
                                    if (!Number.isNaN(value)) onRetarget(Math.max(0, value));
                                }}
                                className="no-spinner h-6 w-16 shrink-0 rounded border border-border/60 bg-card px-1 text-center font-mono"
                            />
                            {plan.frameTarget.free ? (
                                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                    <Check className="size-3 text-[#e87d0d]" /> free
                                </span>
                            ) : (
                                <span className="flex min-w-0 items-center gap-1 text-[11px] text-amber-500">
                                    <AlertTriangle className="size-3 shrink-0" />
                                    <span className="truncate">{plan.frameTarget.conflict}</span>
                                </span>
                            )}
                        </div>
                    ) : null}

                    {plan && plan.candidates.length > 0 ? (
                        <div className="space-y-1">
                            {plan.candidates.map((candidate) => {
                                const on = chosen.has(candidate.id);
                                return (
                                    <label
                                        key={candidate.id}
                                        className={cn(
                                            "flex cursor-pointer items-start gap-2.5 rounded border p-2 text-xs transition-colors",
                                            on
                                                ? "border-[#e87d0d]/50 bg-[#e87d0d]/5"
                                                : "border-border/60 hover:bg-muted/40",
                                        )}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={on}
                                            onChange={() => toggle(candidate.id)}
                                            className="mt-0.5 size-3.5 shrink-0 accent-[#e87d0d]"
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-baseline gap-2">
                                                <span className="font-mono">{candidate.label}</span>
                                                {candidate.changed ? (
                                                    <span className="rounded bg-[#e87d0d]/20 px-1 text-[10px] text-[#e87d0d]">
                                                        changed
                                                    </span>
                                                ) : null}
                                                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                                                    {size(candidate.bytes)}
                                                </span>
                                            </span>
                                            <span className="block text-[10px] text-muted-foreground">
                                                {candidate.note}
                                            </span>
                                            <span className="mt-1 block">
                                                <PackTo target={candidate.files[0].target} />
                                            </span>
                                            {candidate.files.length > 1 ? (
                                                <span className="block text-[10px] text-muted-foreground">
                                                    …and {candidate.files.length - 1} more, each to
                                                    its own archive and file
                                                </span>
                                            ) : null}
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="text-xs text-muted-foreground">
                            Nothing to export — load a model first.
                        </p>
                    )}

                    {picked.some((c) => c.files.some((f) => f.target?.file === null)) ? (
                        <p className="mt-3 text-[11px] text-muted-foreground">
                            This sequence has no id of its own — it was made here — so pick a free
                            file id in archive 12 when you pack the config.
                        </p>
                    ) : null}
                </div>

                <div className="flex items-center gap-3 border-t border-border px-4 py-3">
                    <span className="text-[11px] text-muted-foreground">
                        {fileCount === 0
                            ? "Nothing selected"
                            : `${fileCount} file${fileCount === 1 ? "" : "s"} · ${size(
                                  totalBytes,
                              )} · ${onlyModel ? "downloads as .dat" : "downloads as .zip"}`}
                    </span>
                    <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        className="h-7"
                        disabled={!plan || fileCount === 0}
                        onClick={() => {
                            if (!plan) return;
                            const result = buildBundle(plan, Array.from(chosen));
                            downloadBlob(result.blob, result.fileName);
                            onClose();
                        }}
                    >
                        <Download className="size-3.5" /> Download
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
