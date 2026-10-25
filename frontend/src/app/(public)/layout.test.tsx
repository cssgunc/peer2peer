import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PublicLayout from "./layout";
import Home from "./page";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/components/content/ContactDetails", () => ({
  default: () => <p>Contact details from settings</p>,
}));
vi.mock("@/components/layout/CrisisResources", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/layout/CrisisResources")
    >();
  return { ...actual, default: actual.CrisisResourcesFallback };
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Public layout", () => {
  it("puts the skip link first and points it at the single main landmark", () => {
    const { container } = render(
      <PublicLayout>
        <Home />
      </PublicLayout>,
    );

    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(container.querySelector("a, button, input, select, textarea")).toBe(
      skip,
    );
    const main = screen.getByRole("main");
    expect(skip).toHaveAttribute("href", `#${main.id}`);
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(within(main).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Peer2Peer",
    );
    const header = screen.getByRole("banner");
    const status = screen.getByRole("status");
    expect(
      status.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(status).toHaveTextContent("988");
  });

  it("includes shared contact details in the footer", () => {
    render(
      <PublicLayout>
        <h1>FAQ</h1>
      </PublicLayout>,
    );
    const footer = within(screen.getByRole("contentinfo"));

    expect(
      footer.getByText("Contact details from settings"),
    ).toBeInTheDocument();
  });
});
