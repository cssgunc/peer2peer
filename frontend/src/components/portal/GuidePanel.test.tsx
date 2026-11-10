import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GuidePage from "@/app/portal/guide/page";
import type { Guide, Me } from "@/lib/portal/queries";

import { PortalShell } from "./PortalShell";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/portal/conversations/test-conversation",
  useRouter: () => ({ push, replace }),
}));

const me: Me = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "responder@unc.edu",
  display_name: "Responder",
  role: "responder",
  must_change_password: false,
  shift: null,
};

const guide: Guide = {
  slug: "portal.guide",
  title: "Staff resource guide",
  body_md:
    "## Resources\n\nRead the **responder protocol**.\n\n[Resource directory](https://example.edu/resources)",
  updated_at: null,
};

let queryClient: QueryClient;

function renderPortal(children: ReactNode = <textarea aria-label="Reply" />) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<PortalShell>{children}</PortalShell>, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/auth/me" || path === "/api/portal/guide") {
        return new Response(
          JSON.stringify(path === "/api/auth/me" ? me : guide),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("GuidePanel", () => {
  it("opens from the top bar, renders Markdown, and preserves the conversation draft", async () => {
    const user = userEvent.setup();
    renderPortal();
    const reply = await screen.findByRole("textbox", { name: "Reply" });
    await user.type(reply, "Draft reply");
    const trigger = screen.getByRole("button", { name: "Guide" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith("/api/portal/guide", undefined);
    await user.click(trigger);

    const panel = await screen.findByRole("dialog", {
      name: guide.title,
    });
    expect(
      within(panel).getByRole("heading", { name: "Resources" }),
    ).toBeVisible();
    expect(within(panel).getByText("responder protocol").tagName).toBe(
      "STRONG",
    );
    expect(
      within(panel).getByRole("link", { name: "Resource directory" }),
    ).toHaveAttribute("href", "https://example.edu/resources");

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Reply" })).toBe(reply);
    expect(reply).toHaveValue("Draft reply");
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("closes using the visible close button and restores focus", async () => {
    const user = userEvent.setup();
    renderPortal();
    const trigger = await screen.findByRole("button", { name: "Guide" });
    await user.click(trigger);
    const panel = await screen.findByRole("dialog", { name: guide.title });

    await user.click(
      within(panel).getByRole("button", { name: "Close guide" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("shares one cached guide between the full page and repeated panel openings", async () => {
    const user = userEvent.setup();
    const view = renderPortal(<GuidePage />);
    expect(
      await screen.findByRole("heading", { level: 1, name: guide.title }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Guide" }));
    const panel = await screen.findByRole("dialog", { name: guide.title });
    expect(within(panel).getByText("responder protocol")).toBeVisible();
    await user.keyboard("{Escape}");

    // Leaving the guide page and reopening the panel still uses the same cache entry.
    view.rerender(
      <PortalShell>
        <textarea aria-label="Reply" />
      </PortalShell>,
    );
    await user.click(screen.getByRole("button", { name: "Guide" }));
    expect(
      await screen.findByRole("dialog", { name: guide.title }),
    ).toBeVisible();
    expect(queryClient.getQueryData(["guide"])).toEqual(guide);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([path]) => path === "/api/portal/guide"),
    ).toHaveLength(1);
  });
});
