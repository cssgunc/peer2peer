import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPublicData } from "@/lib/public-data";

import CrisisResources from "./CrisisResources";

vi.mock("next/server", () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/public-data", () => ({ getPublicData: vi.fn() }));

const resources = [
  {
    id: "1",
    name: "Campus Crisis Line",
    description: "",
    url: "https://example.edu/crisis/",
    phone: "(919) 555-0100",
    is_unc: true,
    is_crisis: true,
    tags: [],
  },
  {
    id: "2",
    name: "Text Line",
    description: "",
    url: null,
    phone: "741741",
    is_unc: false,
    is_crisis: true,
    tags: [],
  },
  {
    id: "3",
    name: "Study Skills Center",
    description: "",
    url: "https://example.edu/study",
    phone: "919-555-0199",
    is_unc: true,
    is_crisis: false,
    tags: [],
  },
];

function expectFallback() {
  expect(screen.getByText("Emergency Services")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "911" })).toHaveAttribute(
    "href",
    "tel:911",
  );
  expect(screen.getByText("988 Suicide & Crisis Lifeline")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "988" })).toHaveAttribute(
    "href",
    "tel:988",
  );
}

beforeEach(() => vi.mocked(getPublicData).mockResolvedValue(resources));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("CrisisResources", () => {
  it("renders only crisis resources from the resources API", async () => {
    render(await CrisisResources());

    expect(getPublicData).toHaveBeenCalledWith("/api/resources", "resources");
    expect(
      screen.getByRole("heading", { name: "In crisis? Get help now" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/not a crisis service/)).toBeInTheDocument();
    expect(screen.getByText("Campus Crisis Line")).toBeInTheDocument();
    expect(screen.getByText("Text Line")).toBeInTheDocument();
    expect(screen.queryByText("Study Skills Center")).not.toBeInTheDocument();
    expect(screen.queryByText("Emergency Services")).not.toBeInTheDocument();
  });

  it("shows phone numbers as visible tel: links", async () => {
    render(await CrisisResources());

    expect(
      screen.getByRole("link", { name: "(919) 555-0100" }),
    ).toHaveAttribute("href", "tel:9195550100");
    expect(screen.getByRole("link", { name: "741741" })).toHaveAttribute(
      "href",
      "tel:741741",
    );
  });

  it("shows the website only when there is one", async () => {
    render(await CrisisResources());

    expect(
      screen.getByRole("link", { name: "example.edu/crisis" }),
    ).toHaveAttribute("href", "https://example.edu/crisis/");
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("shows the fallback numbers when the request fails", async () => {
    vi.mocked(getPublicData).mockRejectedValue(
      new Error("Private server details"),
    );
    render(await CrisisResources());

    expectFallback();
    expect(
      screen.queryByText(/Private server details/),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["no resources", []],
    ["no crisis resources", [resources[2]]],
  ])("shows the fallback numbers when there are %s", async (_, data) => {
    vi.mocked(getPublicData).mockResolvedValue(data);
    render(await CrisisResources());

    expectFallback();
    expect(screen.queryByText("Study Skills Center")).not.toBeInTheDocument();
  });
});
