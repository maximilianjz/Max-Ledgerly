// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountsPage from "@/app/accounts/page";
import PayoutsPage from "@/app/payouts/page";
import SellerPage from "@/app/sellers/[externalId]/page";
import { SellerWorkspace } from "@/components/seller-workspace";
import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  payoutSeller: vi.fn(),
  listSellers: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error("not-found");
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/config", () => ({ isWhopConfigured: () => true }));
vi.mock("@/lib/sellers", () => ({
  payoutSeller: mocks.payoutSeller,
  listSellers: mocks.listSellers,
  onboardingIssue: () => null,
  verificationIssue: () => null,
}));
vi.mock("@/components/payout-workspace", () => ({
  PayoutWorkspace: ({ sellerId }: { sellerId: string }) =>
    createElement("p", null, `Balance for ${sellerId}`),
}));
vi.mock("@/components/seller-status", () => ({
  SellerStatus: ({ returned }: { returned: boolean }) =>
    createElement("p", null, returned ? "Returned to verification" : "Account details"),
}));

const seller = {
  externalId: "seller-us",
  accountId: "biz_testUS",
  email: "seller@example.test",
  country: "US",
  platformAccountId: "biz_platform",
};
beforeEach(() => {
  mocks.listSellers.mockResolvedValue([seller]);
  mocks.payoutSeller.mockResolvedValue(seller);
});
afterEach(cleanup);

describe("unified seller workspace", () => {
  it("provides one destination per seller", async () => {
    render(await AccountsPage());
    const links = within(screen.getByRole("listitem")).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toContain("Open workspace");
    expect(links[0].getAttribute("href")).toBe("/sellers/seller-us");
  });

  it("opens account details without starting payouts and preserves onboarding return state", async () => {
    render(
      await SellerPage({
        params: Promise.resolve({ externalId: seller.externalId }),
        searchParams: Promise.resolve({ returned: "1" }),
      }),
    );
    expect(screen.getByRole("tab", { name: "Account" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Returned to verification")).toBeTruthy();
    expect(mocks.payoutSeller).not.toHaveBeenCalled();
    expect(screen.queryByText(/Balance for/)).toBeNull();
  });

  it("opens the selected seller's payout tab directly", async () => {
    render(
      await SellerPage({
        params: Promise.resolve({ externalId: seller.externalId }),
        searchParams: Promise.resolve({ tab: "payouts" }),
      }),
    );
    expect(mocks.payoutSeller).toHaveBeenCalledWith("seller-us");
    expect(screen.getByRole("tab", { name: "Payouts" }).getAttribute("aria-selected")).toBe("true");
    expect(within(screen.getByRole("tabpanel")).getByText("Balance for seller-us")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("retains Account navigation when payouts are unavailable", async () => {
    mocks.payoutSeller.mockRejectedValueOnce(
      new AppError("This seller is suspended.", 403, "seller_suspended"),
    );
    render(
      await SellerPage({
        params: Promise.resolve({ externalId: seller.externalId }),
        searchParams: Promise.resolve({ tab: "payouts" }),
      }),
    );
    expect(screen.getByRole("alert").textContent).toContain("This seller is suspended.");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Account" }), { key: "Enter" });
    expect(mocks.push).toHaveBeenCalledWith("/sellers/seller-us", { scroll: false });
  });

  it("navigates tabs by URL and reflects back/forward selection", () => {
    const view = render(
      createElement(
        SellerWorkspace,
        { externalId: "seller:us", tab: "account", showActivity: false },
        "Account content",
      ),
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: "Payouts" }), { key: "Enter" });
    expect(mocks.push).toHaveBeenCalledWith("/sellers/seller%3Aus?tab=payouts", { scroll: false });
    view.rerender(
      createElement(
        SellerWorkspace,
        { externalId: "seller:us", tab: "payouts", showActivity: false },
        "Payout content",
      ),
    );
    expect(screen.getByRole("tab", { name: "Payouts" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("Payout content");
    view.rerender(
      createElement(
        SellerWorkspace,
        { externalId: "seller:us", tab: "account", showActivity: false },
        "Account content",
      ),
    );
    expect(screen.getByRole("tab", { name: "Account" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("Account content");
  });

  it("keeps Whop return links working and sends unselected payouts to the seller list", async () => {
    await expect(
      PayoutsPage({ searchParams: Promise.resolve({ seller: "seller-us" }) }),
    ).rejects.toThrow("redirect:/sellers/seller-us?tab=payouts");
    await expect(PayoutsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "redirect:/accounts",
    );
    await expect(
      PayoutsPage({ searchParams: Promise.resolve({ seller: "invalid/seller" }) }),
    ).rejects.toThrow("redirect:/accounts");
    expect(mocks.payoutSeller).not.toHaveBeenCalled();
  });
});
