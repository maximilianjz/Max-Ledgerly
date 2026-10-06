// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WithdrawElementCreateOptions } from "@whop/elements/wallet";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WithdrawFunds } from "@/components/withdraw-funds";

const sdk = vi.hoisted(() => ({ useWallet: vi.fn() }));
vi.mock("@whop/elements-react", () => ({ useWallet: sdk.useWallet }));

function walletFixture() {
  const overlay = { open: vi.fn(), close: vi.fn(), destroy: vi.fn() };
  const wallet = {
    createOverlay: vi.fn((_name: string, _options: WithdrawElementCreateOptions) => overlay),
  };
  return { wallet, overlay };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("withdrawal overlay lifecycle", () => {
  it("keeps an open flow across parent renders and uses the current completion callback", () => {
    const { wallet, overlay } = walletFixture();
    sdk.useWallet.mockReturnValue(wallet);
    const initialDone = vi.fn();
    const currentDone = vi.fn();
    const view = render(createElement(WithdrawFunds, { onDone: initialDone }));
    fireEvent.click(screen.getByRole("button", { name: "Withdraw in Ledgerly" }));
    expect(overlay.open).toHaveBeenCalledTimes(1);

    view.rerender(createElement(WithdrawFunds, { onDone: currentDone }));
    expect(wallet.createOverlay).toHaveBeenCalledTimes(1);
    expect(overlay.destroy).not.toHaveBeenCalled();
    act(() => wallet.createOverlay.mock.calls[0][1].onDone?.({}));
    expect(overlay.close).toHaveBeenCalledTimes(1);
    expect(currentDone).toHaveBeenCalledTimes(1);
    expect(initialDone).not.toHaveBeenCalled();
  });

  it("removes the previous seller's overlay when its wallet changes or the page unmounts", () => {
    const first = walletFixture();
    const second = walletFixture();
    sdk.useWallet.mockReturnValue(first.wallet);
    const onDone = vi.fn();
    const view = render(createElement(WithdrawFunds, { onDone }));
    fireEvent.click(screen.getByRole("button", { name: "Withdraw in Ledgerly" }));
    sdk.useWallet.mockReturnValue(second.wallet);
    view.rerender(createElement(WithdrawFunds, { onDone }));
    expect(first.overlay.destroy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw in Ledgerly" }));
    expect(second.overlay.open).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(second.overlay.destroy).toHaveBeenCalledTimes(1);
  });

  it("disables the trigger before the wallet loads and surfaces loading failures", () => {
    sdk.useWallet.mockReturnValue(null);
    const onDone = vi.fn();
    const view = render(createElement(WithdrawFunds, { onDone }));
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    const { wallet, overlay } = walletFixture();
    sdk.useWallet.mockReturnValue(wallet);
    view.rerender(createElement(WithdrawFunds, { onDone }));
    act(() => wallet.createOverlay.mock.calls[0][1].onError?.({ message: "Connection lost." }));
    expect(screen.getByRole("alert").textContent).toContain("Connection lost.");
    fireEvent.click(screen.getByRole("button", { name: "Withdraw in Ledgerly" }));
    expect(overlay.open).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
