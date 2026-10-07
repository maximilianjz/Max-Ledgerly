// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActivityElementCreateOptions, LedgerActivity } from "@whop/elements/wallet";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PayoutActivity } from "@/components/payout-activity";

const sdk = vi.hoisted(() => ({ activity: vi.fn((_props: ActivityElementCreateOptions) => null) }));
vi.mock("@whop/elements-react", () => ({ ActivityElement: sdk.activity }));

const payment: LedgerActivity = {
  object: "ledger_activity",
  id: "activity_payment",
  line_type: "payment_gross",
  amount: "2500",
  usd_amount: "25.00",
  currency: { code: "usd", precision: "2" },
  posted_at: "2026-10-05T15:11:00Z",
  available_at: null,
  resource: {
    object: "user",
    id: "user_fixture",
    name: "Alex Seller",
    username: "alex",
    profile_picture_url: null,
  },
  source: { object: "payment", id: "pay_fixture" },
};
const refund: LedgerActivity = {
  ...payment,
  id: "activity_refund",
  line_type: "payment_refund",
  amount: "-2500",
  usd_amount: "-25.00",
  source: {
    object: "refund",
    id: "rfnd_fixture",
    payment_amount: { amount: "25.00", currency: "usd", decimals: 2, display_decimals: 2 },
  },
};

function select(activity: LedgerActivity) {
  act(() => sdk.activity.mock.lastCall?.[0].onActivitySelected?.({ activity }));
}

beforeEach(() => {
  sdk.activity.mockImplementation(() => null);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("payout activity details", () => {
  it("opens the selected transaction's amount, direction and ID, and replaces the previous details", () => {
    render(createElement(PayoutActivity));
    expect(screen.queryByRole("dialog")).toBeNull();
    select(refund);
    const details = within(screen.getByRole("dialog", { name: "Refund" }));
    expect(details.getByText("-$25.00")).toBeTruthy();
    expect(details.getByText("From").nextElementSibling?.textContent).toBe("USD balance");
    expect(details.getByText("To").nextElementSibling?.textContent).toBe("Alex Seller");
    expect(details.getByText("Original payment").nextElementSibling?.textContent).toBe("$25.00");
    expect(details.getByText("rfnd_fixture")).toBeTruthy();
    fireEvent.click(details.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    select(payment);
    const next = within(screen.getByRole("dialog", { name: "Payment" }));
    expect(next.getByText("+$25.00")).toBeTruthy();
    expect(next.getByText("From").nextElementSibling?.textContent).toBe("Alex Seller");
    expect(next.getByText("pay_fixture")).toBeTruthy();
    expect(screen.queryByText("rfnd_fixture")).toBeNull();
  });

  it("copies only the selected reference and resets copy feedback for the next transaction", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(createElement(PayoutActivity));
    select(refund);
    fireEvent.click(screen.getByRole("button", { name: "Copy refund ID" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("ID copied"));
    expect(writeText).toHaveBeenCalledWith("rfnd_fixture");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    select(payment);
    expect(screen.getByRole("status").textContent).toBe("");
    writeText.mockRejectedValueOnce(new Error("Clipboard blocked"));
    fireEvent.click(screen.getByRole("button", { name: "Copy payment ID" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Couldn’t copy. Select the ID to copy it.",
    );
    expect(screen.getByText("pay_fixture")).toBeTruthy();
  });

  it("restores focus on Escape and removes the dialog and backdrop when the seller changes", async () => {
    const view = render(createElement(PayoutActivity, { key: "seller-us" }));
    const focusTarget = document.createElement("button");
    document.body.appendChild(focusTarget);
    focusTarget.focus();
    select(payment);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(focusTarget));
    expect(screen.queryByRole("dialog")).toBeNull();
    focusTarget.remove();
    select(refund);
    view.rerender(createElement(PayoutActivity, { key: "seller-br" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
    expect(document.body.style.pointerEvents).toBe("");
  });

  it("labels a converted amount and does not turn missing values into a zero payment", () => {
    render(createElement(PayoutActivity));
    select({ ...payment, currency: { code: "eur", precision: "2" }, usd_amount: "27.50" });
    expect(screen.getByText("+$27.50")).toBeTruthy();
    expect(screen.getByText(/USD value of EUR activity/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    select({ ...payment, usd_amount: null, source: null, resource: null });
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getByText("Not provided")).toBeTruthy();
    expect(screen.getByText("activity_payment")).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("preserves readable list errors and clears them on a new selection", () => {
    render(createElement(PayoutActivity));
    act(() => sdk.activity.mock.lastCall?.[0].onError?.({ message: "Connection lost." }));
    expect(screen.getByRole("alert").textContent).toContain("Connection lost.");
    select(payment);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Payment" })).toBeTruthy();
  });
});
