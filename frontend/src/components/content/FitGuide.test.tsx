import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import FitGuide, { type FitGuideData } from "./FitGuide";

afterEach(cleanup);

const guide: FitGuideData = {
  good_fit: [
    {
      id: "good-1",
      text: "You want someone to listen.",
      resource_id: null,
      resource: null,
    },
    {
      id: "good-2",
      text: "You want to talk through everyday stress.",
      resource_id: null,
      resource: null,
    },
  ],
  other_resource: [
    {
      id: "other-1",
      text: "You are looking for ongoing professional care.",
      resource_id: "care",
      resource: {
        id: "care",
        name: "Student care",
        url: "https://example.edu/care",
        phone: "(555) 010-0200",
      },
    },
  ],
};

describe("FitGuide", () => {
  it("renders both lists and preserves the item order", () => {
    render(<FitGuide guide={guide} />);
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Is Peer2Peer right for me?",
      }),
    ).toBeInTheDocument();
    const good = screen.getByRole("list", {
      name: "Peer2Peer is a good fit if...",
    });
    const other = screen.getByRole("list", {
      name: "Another resource may be better if...",
    });
    expect(
      within(good)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(guide.good_fit.map((item) => item.text));
    expect(
      within(other).getByText(guide.other_resource[0].text),
    ).toBeInTheDocument();
  });

  it("links the resource website when one is available", () => {
    render(<FitGuide guide={guide} />);
    const link = screen.getByRole("link", { name: "Student care" });
    expect(link).toHaveAttribute("href", "https://example.edu/care");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("uses a telephone link when the resource has only a phone number", () => {
    const resource = { ...guide.other_resource[0].resource!, url: null };
    render(
      <FitGuide
        guide={{
          ...guide,
          other_resource: [{ ...guide.other_resource[0], resource }],
        }}
      />,
    );
    const link = screen.getByRole("link", {
      name: "Student care: (555) 010-0200",
    });
    expect(link).toHaveAttribute("href", "tel:5550100200");
    expect(link).not.toHaveAttribute("target");
  });

  it("shows no link when the linked resource is absent from the public response", () => {
    render(
      <FitGuide
        guide={{
          ...guide,
          other_resource: [{ ...guide.other_resource[0], resource: null }],
        }}
      />,
    );
    expect(screen.getByText(guide.other_resource[0].text)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows no link when a resource has neither a website nor a phone number", () => {
    const resource = {
      ...guide.other_resource[0].resource!,
      url: null,
      phone: null,
    };
    render(
      <FitGuide
        guide={{
          ...guide,
          other_resource: [{ ...guide.other_resource[0], resource }],
        }}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not render an unsafe resource URL", () => {
    const resource = {
      ...guide.other_resource[0].resource!,
      url: "javascript:alert(1)",
      phone: null,
    };
    render(
      <FitGuide
        guide={{
          ...guide,
          other_resource: [{ ...guide.other_resource[0], resource }],
        }}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
