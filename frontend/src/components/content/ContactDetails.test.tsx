import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPublicData } from "@/lib/public-data";

import ContactDetails from "./ContactDetails";

vi.mock("next/server", () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/public-data", () => ({ getPublicData: vi.fn() }));

const settings = {
  contact_email: "hello@example.edu",
  instagram_handle: "peer_support",
  responder_form_url: "https://example.edu/responders",
};

beforeEach(() => vi.mocked(getPublicData).mockResolvedValue(settings));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("ContactDetails", () => {
  it("uses the settings API for email, Instagram, and the responder form", async () => {
    render(await ContactDetails({ showResponderForm: true }));

    expect(getPublicData).toHaveBeenCalledWith("/api/settings", "settings");
    expect(
      screen.getByRole("link", { name: "hello@example.edu" }),
    ).toHaveAttribute("href", "mailto:hello@example.edu");
    expect(
      screen.getByRole("link", { name: "Instagram (@peer_support)" }),
    ).toHaveAttribute("href", "https://www.instagram.com/peer_support/");
    const responderLink = screen.getByRole("link", {
      name: "Become a Peer Responder",
    });
    expect(responderLink).toHaveAttribute("href", settings.responder_form_url);
    expect(responderLink).toHaveAttribute("target", "_blank");
    expect(responderLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it.each([null, "", "   "])(
    "hides an empty responder form setting (%s)",
    async (url) => {
      vi.mocked(getPublicData).mockResolvedValue({
        ...settings,
        responder_form_url: url,
      });
      render(await ContactDetails({ showResponderForm: true }));

      expect(
        screen.queryByRole("link", { name: "Become a Peer Responder" }),
      ).not.toBeInTheDocument();
    },
  );

  it("omits the responder form in the footer", async () => {
    render(await ContactDetails({}));
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(
      screen.queryByRole("link", { name: "Become a Peer Responder" }),
    ).not.toBeInTheDocument();
  });

  it("accepts an Instagram handle with a leading @", async () => {
    vi.mocked(getPublicData).mockResolvedValue({
      ...settings,
      instagram_handle: "@new_handle",
    });
    render(await ContactDetails({}));

    expect(
      screen.getByRole("link", { name: "Instagram (@new_handle)" }),
    ).toHaveAttribute("href", "https://www.instagram.com/new_handle/");
  });

  it("keeps a settings outage from breaking the page and hides server details", async () => {
    vi.mocked(getPublicData).mockRejectedValue(
      new Error("Private server details"),
    );
    render(await ContactDetails({ showResponderForm: true }));

    expect(
      screen.getByText(/Contact details are temporarily unavailable/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Private server details/),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
