import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPublicData } from "@/lib/public-data";

import AboutPage from "./page";

vi.mock("next/server", () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/public-data", () => ({ getPublicData: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("About page", () => {
  it("renders the three content blocks in order with their titles and Markdown", async () => {
    const blocks = [
      {
        slug: "about.history",
        title: "Our History",
        body_md: "Our **history**.",
      },
      {
        slug: "about.pillars",
        title: "Our Values",
        body_md: "- Listening\n- Respect",
      },
      {
        slug: "about.training",
        title: "Responder Training",
        body_md: "Our training.",
      },
    ];
    vi.mocked(getPublicData).mockImplementation(async (path) =>
      blocks.find((block) => path === `/api/content/${block.slug}`),
    );
    render(await AboutPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "About" }),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(blocks.map((block) => block.title));
    expect(getPublicData).toHaveBeenCalledTimes(3);
    for (const block of blocks) {
      expect(getPublicData).toHaveBeenCalledWith(
        `/api/content/${block.slug}`,
        "content",
      );
      expect(
        screen.getByRole("region", { name: block.title }),
      ).toBeInTheDocument();
    }
    expect(
      screen.getByText("history", { selector: "strong" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Our Values" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(2);
  });

  it("passes content-loading failures to the public error boundary", async () => {
    vi.mocked(getPublicData).mockRejectedValue(
      new Error("Backend unavailable"),
    );
    await expect(AboutPage()).rejects.toThrow("Backend unavailable");
  });
});
