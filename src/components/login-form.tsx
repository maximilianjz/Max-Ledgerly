"use client";

import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useSyncExternalStore } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/client-api";
import { workspaceReturnPath } from "@/lib/seller-contracts";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function LoginForm({
  configured,
  next = "/sellers",
}: {
  configured: boolean;
  next?: string;
}) {
  const router = useRouter();
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const password = new FormData(event.currentTarget).get("password");
    try {
      await apiRequest("/api/auth/login", { body: { password } });
      router.replace(workspaceReturnPath(next));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in.");
    } finally {
      setPending(false);
    }
  }

  if (!configured) {
    return (
      <Alert>
        <AlertDescription>
          Finish setup by running <code>npm run setup</code> in the project, then restart the dev
          server.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form method="post" action="/api/auth/login" onSubmit={submit} className="space-y-5">
      <div className="space-y-2.5">
        <Label htmlFor="password" className="text-sm">
          Assessment password
        </Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={visible ? "text" : "password"}
            autoComplete="current-password"
            required
            disabled={!ready || pending}
            maxLength={256}
            placeholder="Enter your password"
            className="h-12 bg-card pr-12 text-base"
            aria-describedby={error ? "login-error" : undefined}
            aria-invalid={Boolean(error)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-1 right-1 size-10 text-muted-foreground"
            onClick={() => setVisible(!visible)}
            disabled={!ready || pending}
            aria-label={visible ? "Hide password" : "Show password"}
          >
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
      </div>
      {error && (
        <p id="login-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        disabled={!ready || pending}
        className="h-12 w-full justify-between px-5 text-sm"
      >
        {!ready ? "Loading sign-in…" : pending ? "Signing in…" : "Open your workspace"}
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <ArrowRight className="size-4" />
        )}
      </Button>
      <noscript>
        <p className="text-sm text-muted-foreground">Enable JavaScript to sign in.</p>
      </noscript>
    </form>
  );
}
