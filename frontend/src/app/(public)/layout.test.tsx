import { cleanup, render, screen, within } from "@testing-library/react";
import { createContext, useContext, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PublicLayout from "./layout";
import Home from "./page";

const PathnameContext = createContext("/");

vi.mock("next/navigation", () => ({
  usePathname: () => useContext(PathnameContext),
}));
vi.mock("next/script", () => ({
  default: function MockScript({
    onReady,
    ...props
  }: {
    onReady: () => void;
    src: string;
  }) {
    useEffect(() => {
      onReady();
    }, [onReady]);
    return <script {...props} />;
  },
}));
vi.mock("@/components/content/ContactDetails", () => ({
  default: () => <p>Contact details from settings</p>,
}));
vi.mock("@/components/layout/CrisisResources", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/layout/CrisisResources")
    >();
  return { ...actual, default: actual.CrisisResourcesFallback };
});

beforeEach(() => {
  vi.stubEnv("WEBSITE_ANALYTICS_SCRIPT_URL", "");
  vi.stubEnv("WEBSITE_ANALYTICS_SITE_ID", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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
    const header = screen.getByRole("banner");
    const status = screen.getByRole("status");
    expect(
      status.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(status).toHaveTextContent("988");
  });

  it("includes shared contact details in the footer", () => {
    render(
      <PublicLayout>
        <h1>FAQ</h1>
      </PublicLayout>,
    );
    const footer = within(screen.getByRole("contentinfo"));

    expect(
      footer.getByText("Contact details from settings"),
    ).toBeInTheDocument();
  });
});

describe("Website analytics", () => {
  const scriptUrl = "https://analytics.example.com/script.js";
  const siteId = "test-site";
  const layout = (
    <PublicLayout>
      <h1>Public page</h1>
    </PublicLayout>
  );

  it("reports only safe page and referrer data across public navigation", () => {
    vi.stubEnv("WEBSITE_ANALYTICS_SCRIPT_URL", scriptUrl);
    vi.stubEnv("WEBSITE_ANALYTICS_SITE_ID", siteId);
    const track = vi.fn();
    vi.stubGlobal("umami", { track });
    vi.spyOn(document, "referrer", "get").mockReturnValue(
      "https://search.example.com/private/path?token=secret#fragment",
    );

    const { container, rerender } = render(
      <PathnameContext.Provider value="/">{layout}</PathnameContext.Provider>,
    );
    const script = container.querySelector("script[data-website-id]");
    expect(script).toHaveAttribute("src", scriptUrl);
    expect(script).toHaveAttribute("data-website-id", siteId);
    expect(script).toHaveAttribute("data-auto-track", "false");
    expect(script).toHaveAttribute("referrerPolicy", "no-referrer");
    expect(track).toHaveBeenCalledExactlyOnceWith({
      website: siteId,
      hostname: window.location.hostname,
      url: "/",
      referrer: "https://search.example.com",
    });

    rerender(
      <PathnameContext.Provider value="/text-us">
        {layout}
      </PathnameContext.Provider>,
    );
    expect(track).toHaveBeenCalledTimes(1);

    rerender(
      <PathnameContext.Provider value="/faq">
        {layout}
      </PathnameContext.Provider>,
    );
    expect(track).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: "/faq" }),
    );
  });

  it.each([
    "/text-us",
    "/portal",
    "/portal/admin/analytics",
    "/dev/chat",
    "/private-token",
  ])("omits analytics on %s", (path) => {
    vi.stubEnv("WEBSITE_ANALYTICS_SCRIPT_URL", scriptUrl);
    vi.stubEnv("WEBSITE_ANALYTICS_SITE_ID", siteId);
    const { container } = render(
      <PathnameContext.Provider value={path}>
        {layout}
      </PathnameContext.Provider>,
    );
    expect(container.querySelector("script")).toBeNull();
  });

  it.each([
    [scriptUrl, ""],
    ["", siteId],
    ["", ""],
  ])("omits analytics when either configuration value is absent", (url, id) => {
    vi.stubEnv("WEBSITE_ANALYTICS_SCRIPT_URL", url);
    vi.stubEnv("WEBSITE_ANALYTICS_SITE_ID", id);
    const { container } = render(layout);
    expect(container.querySelector("script")).toBeNull();
  });
});
