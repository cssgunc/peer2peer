import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPublicData } from "@/lib/public-data";

import ImpactStats from "./ImpactStats";

vi.mock("@/lib/public-data", () => ({ getPublicData: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("ImpactStats", () => {
  it("renders nothing when no statistics are published", async () => {
    vi.mocked(getPublicData).mockResolvedValue([]);

    const { container } = render(await ImpactStats());

    expect(container).toBeEmptyDOMElement();
    expect(getPublicData).toHaveBeenCalledWith("/api/statistics", "statistics");
  });

  it("shows each value with its label, in the order given", async () => {
    vi.mocked(getPublicData).mockResolvedValue([
      { id: "a", label: "Conversations this semester", value: "120+" },
      { id: "b", label: "Trained responders", value: "24" },
    ]);

    render(await ImpactStats());

    expect(
      screen.getByRole("heading", { level: 2, name: "Our impact" }),
    ).toBeInTheDocument();
    const labels = screen.getAllByRole("term").map((term) => term.textContent);
    const values = screen
      .getAllByRole("definition")
      .map((value) => value.textContent);
    expect(labels).toEqual([
      "Conversations this semester",
      "Trained responders",
    ]);
    expect(values).toEqual(["120+", "24"]);
  });
});
