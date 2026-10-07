// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import type {
  ActivityDetailElementCreateOptions,
  ActivityElementCreateOptions,
  LedgerActivity,
} from "@whop/elements/wallet";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PayoutActivity } from "@/components/payout-activity";

const sdk = vi.hoisted(() => ({
  useWallet: vi.fn(),
  activity: vi.fn((_props: ActivityElementCreateOptions) => null),
}));
vi.mock("@whop/elements-react", () => ({
  useWallet: sdk.useWallet,
  ActivityElement: sdk.activity,
}));

const payment: LedgerActivity = {
  object: "ledger_activity",
  id: "activity_payment",
  line_type: "payment_gross",
  amount: "2500",
  usd_amount: "25.00",
  currency: { code: "usd", precision: "2" },
  posted_at: "2026-10-05T15:11:00Z",
  available_at: null,
  resource: null,
  source: { object: "payment", id: "pay_fixture" },
};
const refund: LedgerActivity = {
  ...payment,
  id: "activity_refund",
  line_type: "payment_refund",
  amount: "-2500",
  usd_amount: "-25.00",
  source: { object: "refund", id: "rfnd_fixture" },
};

function walletFixture() {
  const overlay = { open: vi.fn(), close: vi.fn(), destroy: vi.fn() };
  const wallet = {
    createOverlay: vi.fn((_name: string, _options: ActivityDetailElementCreateOptions) => overlay),
  };
  return { wallet, overlay };
}

function select(activity: LedgerActivity) {
  act(() => sdk.activity.mock.lastCall?.[0].onActivitySelected?.({ activity }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("payout activity details", () => {
  it("opens the selected row and replaces it when another row is selected", () => {
    const { wallet, overlay } = walletFixture();
    sdk.useWallet.mockReturnValue(wallet);
    const view = render(createElement(PayoutActivity));
    expect(overlay.open).not.toHaveBeenCalled();

    select(refund);
    expect(wallet.createOverlay).toHaveBeenLastCalledWith(
      "activityDetail",
      expect.objectContaining({ activity: refund }),
    );
    view.rerender(createElement(PayoutActivity));
    expect(wallet.createOverlay).toHaveBeenCalledTimes(1);
    expect(overlay.destroy).not.toHaveBeenCalled();
    select(payment);
    expect(wallet.createOverlay).toHaveBeenLastCalledWith(
      "activityDetail",
      expect.objectContaining({ activity: payment }),
    );
    expect(overlay.open).toHaveBeenCalledTimes(2);
    expect(overlay.destroy).toHaveBeenCalledTimes(1);
  });

  it("cleans up details when switching wallets or leaving the page", () => {
    sdk.useWallet.mockReturnValue(null);
    const view = render(createElement(PayoutActivity));
    const first = walletFixture();
    sdk.useWallet.mockReturnValue(first.wallet);
    view.rerender(createElement(PayoutActivity));
    select(refund);

    const second = walletFixture();
    sdk.useWallet.mockReturnValue(second.wallet);
    view.rerender(createElement(PayoutActivity));
    expect(first.overlay.destroy).toHaveBeenCalledTimes(1);
    select(payment);
    expect(first.wallet.createOverlay).toHaveBeenCalledTimes(1);
    expect(second.wallet.createOverlay).toHaveBeenCalledWith(
      "activityDetail",
      expect.objectContaining({ activity: payment }),
    );
    view.unmount();
    expect(second.overlay.destroy).toHaveBeenCalledTimes(1);
  });

  it("closes a failed detail overlay, displays its error, and lets the user retry", () => {
    const { wallet, overlay } = walletFixture();
    sdk.useWallet.mockReturnValue(wallet);
    render(createElement(PayoutActivity));
    select(refund);
    act(() => wallet.createOverlay.mock.calls[0][1].onError?.({ message: "Connection lost." }));
    expect(overlay.close).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toContain("Connection lost.");
    select(refund);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(overlay.open).toHaveBeenCalledTimes(2);
  });
});
