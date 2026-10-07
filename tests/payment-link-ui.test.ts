// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentLinkForm } from "@/components/payment-link";
import { WebhookActivity } from "@/components/webhook-activity";
import type { ActivityReceipt } from "@/lib/webhook-activity";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const result = {
  order: { orderId: "order-1", amountMinor: 2500, feeMinor: 200, sellerShareMinor: 2300 },
  checkout: { id: "ch_fixture", purchaseUrl: "https://whop.com/checkout/ch_fixture/" },
  reused: false,
};
beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function product() {
  fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "Preset pack" } });
}

describe("payment link form", () => {
  it("blocks submission before hydration and uses POST rather than leaking form values into URLs", () => {
    const node = document.createElement("div");
    node.innerHTML = renderToStaticMarkup(
      createElement(PaymentLinkForm, { externalId: "seller-us" }),
    );
    expect(node.querySelector("form")?.method).toBe("post");
    expect(node.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });

  it("previews the shared calculation, rejects bad amounts, and submits no caller fee", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(result));
    vi.stubGlobal("fetch", fetch);
    render(createElement(PaymentLinkForm, { externalId: "seller-us" }));
    product();
    expect(screen.getByText("$2.00")).toBeTruthy();
    expect(screen.getByText("$23.00")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Price (USD)"), { target: { value: "50.00" } });
    expect(screen.getByText("$4.00")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Price (USD)"), { target: { value: "25.001" } });
    expect(
      (screen.getByRole("button", { name: "Create payment link" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Price (USD)"), { target: { value: "25.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create payment link" }));
    expect(await screen.findByText("Your payment link is ready.")).toBeTruthy();
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toEqual({ orderId: expect.any(String), title: "Preset pack", amount: "25.00" });
    expect(screen.getByRole("link", { name: "Open checkout" }).getAttribute("href")).toBe(
      result.checkout.purchaseUrl,
    );
    expect(screen.getByText(/does not charge the customer/)).toBeTruthy();
  });

  it("keeps a failed request's ID and inputs through reload without automatically retrying", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Lost response"))
      .mockResolvedValueOnce(Response.json({ ...result, reused: true }));
    vi.stubGlobal("fetch", fetch);
    const first = render(createElement(PaymentLinkForm, { externalId: "seller-us" }));
    product();
    fireEvent.click(screen.getByRole("button", { name: "Create payment link" }));
    await screen.findByText("Lost response");
    expect((screen.getByLabelText("Product name") as HTMLInputElement).disabled).toBe(true);
    first.unmount();
    render(createElement(PaymentLinkForm, { externalId: "seller-us" }));
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry payment link" }));
    await screen.findByText("Your payment link is ready.");
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
    fireEvent.click(screen.getByRole("button", { name: "Create another link" }));
    expect(sessionStorage.getItem("ledgerly:payment-link:seller-us")).toBeNull();
  });

  it("prevents concurrent submission and supports preview when HTTPS setup is incomplete", async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetch);
    const view = render(
      createElement(PaymentLinkForm, { externalId: "seller-us", issue: "Use HTTPS." }),
    );
    product();
    expect(
      (screen.getByRole("button", { name: "Create payment link" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByLabelText("Price (USD)") as HTMLInputElement).disabled).toBe(false);
    view.rerender(createElement(PaymentLinkForm, { externalId: "seller-us" }));
    fireEvent.click(screen.getByRole("button", { name: "Create payment link" }));
    fireEvent.submit(
      (screen.getByLabelText("Price (USD)") as HTMLInputElement).form as HTMLFormElement,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });
});

describe("webhook activity screen", () => {
  const receipt: ActivityReceipt = {
    source: "signed_delivery",
    event_id: "msg_payment",
    type: "payment.succeeded",
    account_id: "biz_seller",
    seller: "seller-us",
    disposition: "routed",
    payload_hash: "fixture",
    received_at: "2026-10-06T12:00:00Z",
    payload: { data: { id: "pay_123", amount: 25 } },
    orderId: "order-123",
    receiptCount: 1,
  };
  it("finds a payment by its order and shows persisted routing details", () => {
    render(createElement(WebhookActivity, { receipts: [receipt], issue: null }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search webhook receipts" }), {
      target: { value: "order-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /payment.succeeded/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("msg_payment")).toBeTruthy();
    expect(screen.getByText("order-123")).toBeTruthy();
    expect(screen.getByText("Stored receipts for this event")).toBeTruthy();
    expect(screen.getByRole("link", { name: "seller-us" }).getAttribute("href")).toBe(
      "/sellers/seller-us",
    );
  });
  it("does not present quarantined samples as matched or create replay actions", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(
      createElement(WebhookActivity, {
        receipts: [{ ...receipt, seller: null, disposition: "quarantined", orderId: null }],
        issue: null,
      }),
    );
    expect(screen.getByText("Needs review")).toBeTruthy();
    expect(screen.queryByText("Matched")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh receipts" }));
    expect(router.refresh).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
