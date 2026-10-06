"use client";

import { ArrowUpRight, Check, Download, LoaderCircle, SlidersHorizontal } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, downloadEvidence } from "@/lib/client-api";
import type { FeeSnapshot } from "@/lib/contracts";

export function FeeSettings({
  enabled,
  onChanged,
  apiPath = "/api/fees",
}: {
  enabled: boolean;
  onChanged: () => void;
  apiPath?: string;
}) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<FeeSnapshot | null>(null);
  const [evidence, setEvidence] = useState<{ before: FeeSnapshot; after: FeeSnapshot } | null>(
    null,
  );
  const [percentage, setPercentage] = useState("1");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt intentionally re-reads fees after a manual refresh.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSnapshot(null);
    apiRequest<FeeSnapshot>(apiPath, { method: "GET", signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setSnapshot(result);
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(caught instanceof Error ? caught.message : "Couldn’t load fees.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, attempt, apiPath]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setEvidence(null);
    try {
      const result = await apiRequest<{ before: FeeSnapshot; after: FeeSnapshot }>(apiPath, {
        method: "PATCH",
        body: { percentage: Number(percentage) },
      });
      setSnapshot(result.after);
      setEvidence(result);
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Couldn’t update the markup. Refresh to check its current value.",
      );
    } finally {
      setSaving(false);
    }
  }
  const maximum = snapshot?.markup.maximum.percentage;
  const canSave =
    snapshot?.markup.adjustable &&
    maximum !== null &&
    maximum !== undefined &&
    percentage !== "" &&
    Number.isFinite(Number(percentage)) &&
    Number(percentage) >= 0 &&
    Number(percentage) <= maximum;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!saving) setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={!enabled} className="text-muted-foreground">
          <SlidersHorizontal className="size-4" />
          Withdrawal pricing
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Crypto withdrawal markup</DialogTitle>
          <DialogDescription>
            Set the percentage Ledgerly adds to this seller’s crypto withdrawals. Whop’s own fees
            still apply.
          </DialogDescription>
        </DialogHeader>
        {loading && (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Reading the current fee settings…
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              <p>{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => setAttempt((value) => value + 1)}
              >
                Refresh settings
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {snapshot && (
          <form onSubmit={save} className="space-y-5 pt-2">
            <dl className="grid grid-cols-2 gap-4 border-y py-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Current markup</dt>
                <dd className="mt-1 font-semibold">{snapshot.markup.percentage}%</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Existing fixed markup</dt>
                <dd className="mt-1 font-semibold">
                  {snapshot.markup.fixed.amount} {snapshot.markup.fixed.currency.toUpperCase()}
                </dd>
              </div>
            </dl>
            <div className="space-y-2">
              <Label htmlFor="markup-percentage">New percentage</Label>
              <div className="relative">
                <Input
                  id="markup-percentage"
                  type="number"
                  min="0"
                  max={maximum ?? 100}
                  step="0.01"
                  required
                  value={percentage}
                  disabled={saving || !snapshot.markup.adjustable || maximum == null}
                  onChange={(event) => setPercentage(event.target.value)}
                  className="pr-10"
                />
                <span className="absolute inset-y-0 right-4 flex items-center text-muted-foreground">
                  %
                </span>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {maximum == null
                  ? "Whop has not supplied a permitted percentage limit."
                  : `Whop allows up to ${maximum}%. The fixed markup stays unchanged.`}
              </p>
            </div>
            {!snapshot.markup.adjustable && (
              <p className="text-sm text-destructive">
                Ledgerly’s API key needs permission to manage connected-account fees.
              </p>
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              This updates the production seller’s pricing. It does not initiate a withdrawal.
            </p>
            <Button type="submit" className="w-full" disabled={!canSave || saving || loading}>
              {saving ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <ArrowUpRight className="size-4" />
              )}
              {saving ? "Applying and verifying…" : `Apply ${percentage || "0"}% markup`}
            </Button>
          </form>
        )}
        {evidence && (
          <div className="space-y-3 border-t pt-4">
            <p role="status" className="flex items-center gap-2 text-sm text-primary">
              <Check className="size-4" />
              Saved and confirmed with Whop.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadEvidence("ledgerly-crypto-markup-evidence.json", evidence)}
            >
              <Download className="size-4" />
              Download before and after
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
