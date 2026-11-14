import { cleanup, render, screen } from "@testing-library/react";
import { useSearchParams } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IdleSignOutNotice } from "./IdleSignOutNotice";

vi.mock("next/navigation", () => ({ useSearchParams: vi.fn() }));

afterEach(cleanup);

function renderWith(query: string) {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(query) as unknown as ReturnType<typeof useSearchParams>,
  );
  return render(<IdleSignOutNotice />);
}

describe("IdleSignOutNotice", () => {
  it("explains an idle sign-out", () => {
    renderWith("reason=idle");

    expect(screen.getByRole("status")).toHaveTextContent(
      "You were signed out after 30 minutes of inactivity.",
    );
  });

  it.each(["", "reason=other"])("shows nothing for %j", (query) => {
    const { container } = renderWith(query);

    expect(container).toBeEmptyDOMElement();
  });
});
