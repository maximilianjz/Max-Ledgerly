// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePayoutSession } from "@/hooks/use-payout-session";
import { PAYOUT_SCOPES, TOKEN_TTL_MS } from "@/lib/contracts";

const fetchMock = vi.fn<typeof fetch>();
const now = Date.UTC(2026, 9, 5, 12);
function tokenResponse(token = "test-scoped-token") {
  return new Response(
    JSON.stringify({
      accountId: "biz_testUS",
      token,
      issuedAt: new Date(Date.now()).toISOString(),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      scopedActions: [...PAYOUT_SCOPES],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => tokenResponse());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("payout token lifecycle", () => {
  it("does not call the token API when the key has not been configured", async () => {
    renderHook(() => usePayoutSession(false));
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refreshes a minute before expiry without clearing the working session", async () => {
    const { result } = renderHook(() => usePayoutSession(true));
    await act(async () => {});
    expect(result.current.session?.token).toBe("test-scoped-token");
    fetchMock.mockImplementation(async () => tokenResponse("new-token"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOKEN_TTL_MS - 60_000);
    });
    expect(result.current.session?.token).toBe("new-token");
    expect(Date.parse(result.current.session?.expiresAt || "")).toBe(
      now + TOKEN_TTL_MS * 2 - 60_000,
    );
  });
  it("removes the token at expiry if background refresh keeps failing", async () => {
    const { result } = renderHook(() => usePayoutSession(true));
    await act(async () => {});
    fetchMock.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOKEN_TTL_MS - 60_000);
    });
    expect(result.current.session).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current.session).toBeNull();
    expect(result.current.error).not.toBeNull();
  });
  it("does not leave an old token mounted when a manual reconnect fails", async () => {
    const { result } = renderHook(() => usePayoutSession(true));
    await act(async () => {});
    fetchMock.mockRejectedValue(new Error("offline"));
    await act(async () => {
      result.current.retry();
    });
    expect(result.current.session).toBeNull();
    expect(result.current.error).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOKEN_TTL_MS);
    });
    expect(result.current.session).toBeNull();
  });
  it("rechecks expiry when a sleeping browser tab becomes visible", async () => {
    const { result } = renderHook(() => usePayoutSession(true));
    await act(async () => {});
    vi.setSystemTime(now + TOKEN_TTL_MS + 1000);
    fetchMock.mockRejectedValue(new Error("offline"));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.session).toBeNull();
  });
  it("cancels scheduled refreshes when leaving the page", async () => {
    const { unmount } = renderHook(() => usePayoutSession(true));
    await act(async () => {});
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOKEN_TTL_MS * 2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
