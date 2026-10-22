import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import NotFound from "../not-found";
import PublicError from "./error";

vi.mock("next/navigation", () => ({ usePathname: () => "/missing" }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Public fallbacks", () => {
  it("does not display or log error details", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("private message content"), {
      digest: "private-error-digest",
    });
    const { container } = render(<PublicError error={error} retry={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Something went wrong",
    );
    expect(container).not.toHaveTextContent(error.message);
    expect(container).not.toHaveTextContent(error.digest);
    expect(log).not.toHaveBeenCalled();
  });

  it("can retry loading the page", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<PublicError error={new Error("private")} retry={retry} />);

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "error",
      () => <PublicError error={new Error("private")} retry={vi.fn()} />,
    ],
    ["not found", () => <NotFound />],
  ] as const)(
    "shows a home link and plain-text emergency numbers on the %s page",
    (_, fallback) => {
      const { container } = render(fallback());

      expect(screen.getByRole("link", { name: "Return home" })).toHaveAttribute(
        "href",
        "/",
      );
      expect(screen.getByText(/For emergencies, call 911/)).toHaveTextContent(
        "988",
      );
      expect(
        container.querySelector('a[href^="tel:"], a[href^="sms:"]'),
      ).toBeNull();
    },
  );
});
