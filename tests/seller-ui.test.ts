// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function enterSellerDetails() {
  fireEvent.change(screen.getByLabelText("Seller ID in Ledgerly"), {
    target: { value: seller.externalId },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Seller email"), { target: { value: seller.email } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

function chooseCountry(name = "Canada", code = "CA") {
  fireEvent.click(screen.getByRole("combobox", { name: "Country" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Search countries" }), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole("option", { name: `${name} (${code})` }));
}

describe("seller onboarding screens", () => {
  it("does not submit seller details into the URL before hydration", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(createElement(SellerOnboarding, { issue: null }));
    expect(container.querySelector("form")?.method).toBe("post");
    expect(container.querySelector<HTMLInputElement>("input[name=externalId]")?.disabled).toBe(
      true,
    );
    expect(container.querySelector<HTMLButtonElement>("button[type=submit]")?.disabled).toBe(true);
  });
  it("collects one detail at a time and submits only after the country is selected", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ seller }));
    vi.stubGlobal("fetch", fetch);
    render(createElement(SellerOnboarding, { issue: null }));
    const id = screen.getByLabelText("Seller ID in Ledgerly") as HTMLInputElement;
    await waitFor(() => expect(id.disabled).toBe(false));
    expect(document.activeElement).toBe(id);
    expect(screen.queryByLabelText("Seller email")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Country" })).toBeNull();
    fireEvent.change(id, { target: { value: seller.externalId } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const email = screen.getByLabelText("Seller email");
    expect(document.activeElement).toBe(email);
    expect(screen.queryByLabelText("Seller ID in Ledgerly")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(email, { target: { value: seller.email } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Country" }));
    expect(screen.queryByLabelText("Seller email")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Connect seller" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    chooseCountry();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect seller" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/sellers/seller-us"));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/api/sellers");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      externalId: seller.externalId,
      email: seller.email,
      country: "CA",
    });
  });
  it("keeps missing or invalid details on their own step", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(createElement(SellerOnboarding, { issue: null }));
    const id = screen.getByLabelText("Seller ID in Ledgerly") as HTMLInputElement;
    for (const value of ["", "invalid seller id"]) {
      fireEvent.change(id, { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      expect(screen.queryByLabelText("Seller email")).toBeNull();
      expect(id.validity.valid).toBe(false);
    }
    fireEvent.change(id, { target: { value: seller.externalId } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const email = screen.getByLabelText("Seller email") as HTMLInputElement;
    for (const value of ["", "invalid-email", "seller@localhost"]) {
      fireEvent.change(email, { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      expect(screen.queryByRole("combobox", { name: "Country" })).toBeNull();
      expect(email.validity.valid).toBe(false);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves every field when going back and editing an earlier step", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(createElement(SellerOnboarding, { issue: null }));
    enterSellerDetails();
    chooseCountry();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByLabelText("Seller email") as HTMLInputElement).value).toBe(seller.email);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    const id = screen.getByLabelText("Seller ID in Ledgerly") as HTMLInputElement;
    expect(id.value).toBe(seller.externalId);
    fireEvent.change(id, { target: { value: "seller-updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((screen.getByLabelText("Seller email") as HTMLInputElement).value).toBe(seller.email);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("combobox", { name: "Country" }).textContent).toBe("Canada");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("searches by country code and selects with the keyboard without submitting the form", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(createElement(SellerOnboarding, { issue: null }));
    enterSellerDetails();
    const country = screen.getByRole("combobox", { name: "Country" });
    fireEvent.click(country);
    const search = screen.getByRole("combobox", { name: "Search countries" });
    fireEvent.change(search, { target: { value: "not-a-country" } });
    expect(screen.getByText("No countries found.")).toBeTruthy();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(country.textContent).toBe("Select a country");
    fireEvent.change(search, { target: { value: "jp" } });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Japan (JP)" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    fireEvent.keyDown(search, { key: "Enter" });
    expect(country.textContent).toBe("Japan");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(country));
  });
  it("preserves form details on errors so retries use the same seller identity", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: "Try again with the same seller ID." } },
          { status: 502 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ seller }));
    vi.stubGlobal("fetch", fetch);
    render(createElement(SellerOnboarding, { issue: null }));
    enterSellerDetails();
    chooseCountry();
    fireEvent.click(screen.getByRole("button", { name: "Connect seller" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Country" }).textContent).toBe("Canada");
    fireEvent.click(screen.getByRole("button", { name: "Connect seller" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/sellers/seller-us"));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      externalId: seller.externalId,
      email: seller.email,
      country: "CA",
    });
  });
  it("blocks navigation and repeat submission while connecting", async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    render(createElement(SellerOnboarding, { issue: null }));
    enterSellerDetails();
    chooseCountry();
    fireEvent.click(screen.getByRole("button", { name: "Connect seller" }));
    for (const name of ["Connecting…", "Back"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    const country = screen.getByRole("combobox", { name: "Country" }) as HTMLButtonElement;
    expect(country.disabled).toBe(true);
    fireEvent.submit(country.form as HTMLFormElement);
    expect(fetch).toHaveBeenCalledTimes(1);
    finish(Response.json({ seller }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/sellers/seller-us"));
  });
  it("keeps onboarding disabled when workspace configuration needs attention", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(createElement(SellerOnboarding, { issue: "Configure the workspace first." }));
    const id = screen.getByLabelText("Seller ID in Ledgerly") as HTMLInputElement;
    expect(id.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.submit(id.form as HTMLFormElement);
    expect(fetch).not.toHaveBeenCalled();
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
    expect(await screen.findByText("Verify identity")).toBeTruthy();
    expect(screen.queryByText("pending")).toBeNull();
    expect(screen.queryByText(seller.accountId)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Account details" }));
    expect(screen.getByText("pending")).toBeTruthy();
    expect(screen.getByText(seller.accountId)).toBeTruthy();
    expect(screen.queryByText("approved")).toBeNull();
    expect(screen.getByText(/reflects Whop’s latest review/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("link", { name: /Open seller payouts/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    fireEvent.click(await screen.findByRole("button", { name: "Account details" }));
    expect(screen.getByText("approved")).toBeTruthy();
    expect(screen.queryByText("Verify identity")).toBeNull();
    expect(screen.getByText("No additional actions requested.")).toBeTruthy();
    expect(
      fetch.mock.calls.every(
        ([url, options]) => url === "/api/sellers/seller-us" && options.method === "GET",
      ),
    ).toBe(true);
  });
  it.each([pending.requiredActions, null])(
    "explains expired links and disables verification on HTTP without disabling status reads (actions: %j)",
    async (requiredActions) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({ ...pending, requiredActions })),
      );
      render(
        createElement(SellerStatus, {
          externalId: seller.externalId,
          issue: "Verification needs HTTPS hosting.",
          returned: false,
          refresh: true,
        }),
      );
      await screen.findByRole("button", { name: "Account details" });
      expect(screen.getAllByText("Verification needs HTTPS hosting.")).toHaveLength(1);
      expect(screen.getByText(/previous verification link expired/)).toBeTruthy();
      expect(
        (screen.getByRole("button", { name: "Continue on Whop" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        (screen.getByRole("button", { name: "Refresh status" }) as HTMLButtonElement).disabled,
      ).toBe(false);
    },
  );
  it("keeps verification accessible outside account details when Whop omits requirements", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ...pending,
          verification: { individual: null, business: null },
          requiredActions: null,
          capabilities: {},
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ error: { message: "Try verification again shortly." } }, { status: 502 }),
      );
    vi.stubGlobal("fetch", fetch);
    render(
      createElement(SellerStatus, {
        externalId: seller.externalId,
        issue: null,
        returned: false,
        refresh: false,
      }),
    );
    const button = await screen.findByRole("button", { name: "Continue on Whop" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(/Verification details are unavailable/)).toBeTruthy();
    fireEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Try verification again shortly.",
    );
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/sellers/seller-us/onboarding",
      expect.objectContaining({ method: "POST" }),
    );
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
