// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SellerOnboarding } from "@/components/seller-onboarding";
import { SellerStatus } from "@/components/seller-status";
import type { SellerStatus as Status } from "@/lib/seller-contracts";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const seller = {
  externalId: "seller-us",
  email: "seller@example.test",
  country: "US",
  accountId: "biz_testUS",
  platformAccountId: "biz_platform",
};
const pending: Status = {
  seller,
  status: "active",
  verification: { individual: "pending", business: null },
  requiredActions: [
    { title: "Verify identity", description: "Continue with Whop", status: "required" },
  ],
  capabilities: { crypto_payout: "inactive" },
  checkedAt: "2026-10-05T20:00:00Z",
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("seller onboarding screens", () => {
  it("does not submit seller details into the URL before hydration", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      createElement(SellerOnboarding, { sellers: [], issue: null }),
    );
    expect(container.querySelector("form")?.method).toBe("post");
    expect(container.querySelector<HTMLInputElement>("input[name=email]")?.disabled).toBe(true);
  });
  it("sends the selected country and stable seller ID, then opens that seller's account", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ seller }));
    vi.stubGlobal("fetch", fetch);
    render(createElement(SellerOnboarding, { sellers: [], issue: null }));
    const id = screen.getByLabelText("Seller ID in Ledgerly") as HTMLInputElement;
    await waitFor(() => expect(id.disabled).toBe(false));
    fireEvent.change(id, { target: { value: seller.externalId } });
    fireEvent.change(screen.getByLabelText("Seller email"), { target: { value: seller.email } });
    fireEvent.click(screen.getByRole("button", { name: "Germany" }));
    fireEvent.submit(id.form as HTMLFormElement);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/sellers/seller-us"));
    expect(fetch.mock.calls[0][0]).toBe("/api/sellers");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      externalId: seller.externalId,
      email: seller.email,
      country: "DE",
    });
  });
  it("preserves form details on errors so retries use the same seller identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: "Try again with the same seller ID." } },
            { status: 502 },
          ),
        ),
    );
    render(createElement(SellerOnboarding, { sellers: [], issue: null }));
    const id = screen.getByLabelText("Seller ID in Ledgerly") as HTMLInputElement;
    fireEvent.change(id, { target: { value: seller.externalId } });
    fireEvent.change(screen.getByLabelText("Seller email"), { target: { value: seller.email } });
    fireEvent.submit(id.form as HTMLFormElement);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(id.value).toBe(seller.externalId);
    expect((screen.getByLabelText("Seller email") as HTMLInputElement).value).toBe(seller.email);
  });
  it("reads status on return and displays pending review until a refreshed response approves it", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(pending))
      .mockResolvedValueOnce(
        Response.json({
          ...pending,
          verification: { individual: "approved", business: null },
          requiredActions: [],
          capabilities: { crypto_payout: "active" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    render(
      createElement(SellerStatus, {
        externalId: seller.externalId,
        issue: null,
        returned: true,
        refresh: false,
      }),
    );
    expect(await screen.findByText("pending")).toBeTruthy();
    expect(screen.queryByText("approved")).toBeNull();
    expect(screen.getByText(/does not necessarily mean the review is finished/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open seller payouts/ }).getAttribute("href")).toBe(
      "/payouts?seller=seller-us",
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    expect(await screen.findByText("approved")).toBeTruthy();
    expect(screen.getByText(/not requesting any additional actions/)).toBeTruthy();
    expect(
      fetch.mock.calls.every(
        ([url, options]) => url === "/api/sellers/seller-us" && options.method === "GET",
      ),
    ).toBe(true);
  });
  it("explains expired links and disables verification on HTTP without disabling status reads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(pending)));
    render(
      createElement(SellerStatus, {
        externalId: seller.externalId,
        issue: "Verification needs HTTPS hosting.",
        returned: false,
        refresh: true,
      }),
    );
    await screen.findByText("pending");
    expect(screen.getByText(/previous verification link expired/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Continue on Whop" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Refresh status" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
