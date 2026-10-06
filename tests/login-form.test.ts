// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("login credential handling", () => {
  it("cannot submit a password in the URL before the client script loads", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(createElement(LoginForm, { configured: true }));
    const form = container.querySelector("form");
    expect(form?.method).toBe("post");
    expect(form?.getAttribute("action")).toBe("/api/auth/login");
    expect(container.querySelector<HTMLInputElement>("input[name=password]")?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("button[type=submit]")?.disabled).toBe(true);
  });

  it("sends the password in the POST body and navigates only after successful login", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(LoginForm, { configured: true }));
    const input = screen.getByLabelText("Assessment password") as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: "test-assessment-password" } });
    fireEvent.submit(input.form as HTMLFormElement);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/sellers"));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/login");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ password: "test-assessment-password" });
  });
});
