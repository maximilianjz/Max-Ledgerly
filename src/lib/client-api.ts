import type { ApiFailure } from "@/lib/contracts";

export class ClientApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  options: { method?: "GET" | "POST" | "PATCH"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = options.method || "POST";
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    ...(method === "GET" ? {} : { body: JSON.stringify(options.body ?? {}) }),
    signal: options.signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = data as ApiFailure | null;
    throw new ClientApiError(
      failure?.error?.message || "The request failed. Try again.",
      response.status,
      failure?.error?.requestId,
    );
  }
  return data as T;
}

export function downloadEvidence(filename: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
