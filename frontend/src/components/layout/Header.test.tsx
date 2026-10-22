import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePathname } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Header } from "./Header";

vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));

beforeEach(() => {
  vi.mocked(usePathname).mockReturnValue("/");
});

afterEach(cleanup);

const routes = [
  ["Home", "/"],
  ["FAQ", "/faq"],
  ["Resources", "/resources"],
  ["About", "/about"],
  ["Contact", "/contact"],
  ["Text Us", "/text-us"],
];

describe("Header", () => {
  it("links the name home and renders every public navigation link", () => {
    render(<Header />);

    expect(screen.getByRole("link", { name: "Peer2Peer" })).toHaveAttribute(
      "href",
      "/",
    );
    const navigation = within(
      screen.getByRole("navigation", { name: "Primary" }),
    );
    for (const [name, href] of routes) {
      expect(navigation.getByRole("link", { name })).toHaveAttribute(
        "href",
        href,
      );
    }
    expect(navigation.getAllByRole("link")).toHaveLength(routes.length);
  });

  it.each(routes)(
    "marks only %s as the current page at %s",
    (name, pathname) => {
      vi.mocked(usePathname).mockReturnValue(pathname);
      render(<Header />);

      const navigation = within(
        screen.getByRole("navigation", { name: "Primary" }),
      );
      expect(navigation.getAllByRole("link", { current: "page" })).toEqual([
        navigation.getByRole("link", { name }),
      ]);
      for (const link of navigation.getAllByRole("link")) {
        if (link.textContent !== name) {
          expect(link).not.toHaveAttribute("aria-current");
        }
      }
    },
  );

  it("updates the current link when the pathname changes", () => {
    const { rerender } = render(<Header />);
    vi.mocked(usePathname).mockReturnValue("/contact");
    rerender(<Header />);

    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "Contact" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens with the keyboard, focuses the menu, and closes on Escape with focus restored", async () => {
    const user = userEvent.setup();
    vi.mocked(usePathname).mockReturnValue("/resources");
    render(<Header />);

    const trigger = screen.getByRole("button", {
      name: "Open navigation menu",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    trigger.focus();
    await user.keyboard("{Enter}");

    const dialog = screen.getByRole("dialog", { name: "Peer2Peer menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    for (const [name, href] of routes) {
      expect(within(dialog).getByRole("link", { name })).toHaveAttribute(
        "href",
        href,
      );
    }
    expect(within(dialog).getAllByRole("link", { current: "page" })).toEqual([
      within(dialog).getByRole("link", { name: "Resources" }),
    ]);
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("keeps keyboard focus inside the open menu", async () => {
    const user = userEvent.setup();
    render(<Header />);
    await user.click(
      screen.getByRole("button", { name: "Open navigation menu" }),
    );

    const dialog = screen.getByRole("dialog");
    const firstLink = within(dialog).getByRole("link", { name: "Home" });
    const close = within(dialog).getByRole("button", {
      name: "Close navigation menu",
    });
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    firstLink.focus();

    await user.tab({ shift: true });
    expect(close).toHaveFocus();
    await user.tab();
    expect(firstLink).toHaveFocus();
  });

  it("closes with the close button and returns focus to the menu button", async () => {
    const user = userEvent.setup();
    render(<Header />);
    const trigger = screen.getByRole("button", {
      name: "Open navigation menu",
    });

    await user.click(trigger);
    await user.click(
      screen.getByRole("button", { name: "Close navigation menu" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("closes after a menu link is selected", async () => {
    const user = userEvent.setup();
    render(<Header />);
    await user.click(
      screen.getByRole("button", { name: "Open navigation menu" }),
    );

    await user.click(
      within(screen.getByRole("dialog")).getByRole("link", { name: "Home" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
