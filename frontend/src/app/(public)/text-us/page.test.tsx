import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPublicData } from "@/lib/public-data";

import TextUsPage from "./page";

vi.mock("next/server", () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/public-data", () => ({ getPublicData: vi.fn() }));
vi.mock("@/components/chat/LineStatusNotice", () => ({
  default: () => <p>Line status</p>,
}));
vi.mock("@/components/chat/TextUsChat", () => ({
  default: ({ notice }: { notice: string }) => (
    <div data-testid="chat">{notice}</div>
  ),
}));

type Settings = { sms_number: string | null; channels: ("web" | "sms")[] };

function mockData(settings: Settings) {
  vi.mocked(getPublicData).mockImplementation(async (path) => {
    if (path === "/api/settings") return settings;
    if (path === "/api/content/text-us.intro") {
      return {
        slug: "text-us.intro",
        title: "Text Us",
        body_md: "Say **hi**.",
      };
    }
    if (path === "/api/content/chat.notice") {
      return { slug: "chat.notice", title: "Before", body_md: "The notice" };
    }
    throw new Error(`Unexpected ${path}`);
  });
}

async function renderPage() {
  render(await TextUsPage());
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("Text Us page", () => {
  it("passes content-loading failures to the public error boundary", async () => {
    vi.mocked(getPublicData).mockRejectedValue(
      new Error("Backend unavailable"),
    );
    await expect(TextUsPage()).rejects.toThrow("Backend unavailable");
  });

  it("shows the intro, the line status, and the chat with the notice", async () => {
    mockData({ sms_number: null, channels: ["web"] });
    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Text Us" }),
    ).toBeInTheDocument();
    expect(screen.getByText("hi", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("Line status")).toBeInTheDocument();
    expect(screen.getByTestId("chat")).toHaveTextContent("The notice");
    expect(screen.queryByRole("link", { name: /\d/ })).not.toBeInTheDocument();
  });

  it("hides the chat when web chat isn't an enabled channel", async () => {
    mockData({ sms_number: "(919) 555-0100", channels: ["sms"] });
    await renderPage();

    expect(screen.queryByTestId("chat")).not.toBeInTheDocument();
  });

  it("links the SMS number with an sms: URI when one is set", async () => {
    mockData({ sms_number: "(919) 555-0100", channels: ["web", "sms"] });
    await renderPage();

    expect(
      screen.getByRole("link", { name: "(919) 555-0100" }),
    ).toHaveAttribute("href", "sms:9195550100");
    expect(screen.getByTestId("chat")).toBeInTheDocument();
  });
});
