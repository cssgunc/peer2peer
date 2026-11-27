import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { getPublicData } from "@/lib/public-data";
import PublishedImpactStats from "./PublishedImpactStats";

vi.mock("@/lib/public-data", () => ({ getPublicData: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("loads public statistics using the statistics cache tag", async () => {
  vi.mocked(getPublicData).mockResolvedValue([
    { id: "a", label: "Students trained", value: "120+" },
  ]);
  render(await PublishedImpactStats());

  expect(getPublicData).toHaveBeenCalledWith("/api/statistics", "statistics");
  expect(screen.getByRole("term")).toHaveTextContent("Students trained");
  expect(screen.getByRole("definition")).toHaveTextContent("120+");
});

it("hides the Home page impact section when nothing is published", async () => {
  vi.mocked(getPublicData).mockResolvedValue([]);
  const { container } = render(await PublishedImpactStats());
  expect(container).toBeEmptyDOMElement();
});
