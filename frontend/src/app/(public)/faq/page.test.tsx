import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FitGuideData } from "@/components/content/FitGuide";
import { getPublicData } from "@/lib/public-data";

import FaqPage from "./page";

vi.mock("next/server", () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/public-data", () => ({ getPublicData: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const guide: FitGuideData = {
  good_fit: [
    {
      id: "good",
      text: "You want a listening ear.",
      resource_id: null,
      resource: null,
    },
  ],
  other_resource: [],
};

describe("FAQ page", () => {
  it("loads the two public endpoints with their cache tags and puts the guide first", async () => {
    vi.mocked(getPublicData).mockImplementation(async (path) =>
      path === "/api/fit-guide"
        ? guide
        : [
            {
              id: "question",
              category: "Getting started",
              question: "How do I begin?",
              answer_md: "Choose Text Us.",
            },
          ],
    );
    render(await FaqPage());
    expect(getPublicData).toHaveBeenCalledWith("/api/fit-guide", "fit-guide");
    expect(getPublicData).toHaveBeenCalledWith("/api/faqs", "faqs");
    expect(getPublicData).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("heading", { level: 1, name: "FAQ" }),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(["Is Peer2Peer right for me?", "Getting started"]);
    expect(screen.getByText("You want a listening ear.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "How do I begin?" }),
    ).toBeInTheDocument();
  });

  it("keeps the fit guide without empty FAQ headings when no FAQs are published", async () => {
    vi.mocked(getPublicData).mockImplementation(async (path) =>
      path === "/api/fit-guide" ? guide : [],
    );
    render(await FaqPage());
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Is Peer2Peer right for me?",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("passes request failures to the existing public error boundary", async () => {
    vi.mocked(getPublicData).mockRejectedValue(
      new Error("Backend unavailable"),
    );
    await expect(FaqPage()).rejects.toThrow("Backend unavailable");
  });
});
