import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PublicLayout from "./layout";
import Home from "./page";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

afterEach(cleanup);

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
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("includes the contact links in the footer", () => {
    render(
      <PublicLayout>
        <h1>FAQ</h1>
      </PublicLayout>,
    );
    const footer = within(screen.getByRole("contentinfo"));

    expect(
      footer.getByRole("link", { name: "peer2peernc@unc.edu" }),
    ).toHaveAttribute("href", "mailto:peer2peernc@unc.edu");
    expect(
      footer.getByRole("link", { name: "Instagram (@uncpeer2peer)" }),
    ).toHaveAttribute("href", "https://www.instagram.com/uncpeer2peer/");
  });
});
