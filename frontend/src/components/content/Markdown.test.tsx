import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Markdown from "./Markdown";

afterEach(cleanup);

describe("Markdown", () => {
  it("renders a list and a link with prose styling", () => {
    const { container } = render(
      <Markdown>{"- First\n- [Second](/about)"}</Markdown>,
    );
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Second" })).toHaveAttribute(
      "href",
      "/about",
    );
    expect(container.firstChild).toHaveClass("prose");
  });

  it("never renders script elements", () => {
    const { container } = render(
      <Markdown>{'<script>alert("unsafe")</script>'}</Markdown>,
    );
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("alert");
  });

  it("does not interpret raw HTML as bold", () => {
    const { container } = render(<Markdown>{"<b>raw</b>"}</Markdown>);
    expect(container.querySelector("b, strong")).not.toBeInTheDocument();
  });

  it("does not render Markdown or HTML images", () => {
    const { container } = render(
      <Markdown>
        {
          '![Tracking](https://example.com/pixel.png)\n\n<img src="https://example.com/pixel.png" />'
        }
      </Markdown>,
    );
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it.each([
    "javascript:alert%281%29",
    "JaVaScRiPt:alert%281%29",
    "data:text/html,unsafe",
  ])("drops the href for an unsafe URL: %s", (url) => {
    render(<Markdown>{`[Unsafe](${url})`}</Markdown>);
    expect(screen.getByText("Unsafe")).not.toHaveAttribute("href");
  });

  it("renders level-one Markdown headings as h2", () => {
    const { container } = render(<Markdown>{"# Title"}</Markdown>);
    expect(
      screen.getByRole("heading", { level: 2, name: "Title" }),
    ).toBeInTheDocument();
    expect(container.querySelector("h1")).not.toBeInTheDocument();
  });

  it.each(["https://example.com", "http://example.com", "//example.com"])(
    "opens external links safely in a new tab: %s",
    (url) => {
      render(<Markdown>{`[External](${url})`}</Markdown>);
      const link = screen.getByRole("link", { name: "External" });
      expect(link).toHaveAttribute("href", url);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    },
  );

  it.each(["mailto:support@example.com", "tel:+19195550123", "/about", "#faq"])(
    "preserves local and contact links: %s",
    (url) => {
      render(<Markdown>{`[Contact](${url})`}</Markdown>);
      const link = screen.getByRole("link", { name: "Contact" });
      expect(link).toHaveAttribute("href", url);
      expect(link).not.toHaveAttribute("target");
    },
  );

  it("renders paragraphs, headings, emphasis, blockquotes, and GFM tables", () => {
    const { container } = render(
      <Markdown>
        {
          "## Section\n\nA **bold** and *italic* paragraph.\n\n> Quote\n\n| Question | Answer |\n| --- | --- |\n| Who? | Peer2Peer |"
        }
      </Markdown>,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Section" }),
    ).toBeInTheDocument();
    expect(container.querySelector("p strong")).toHaveTextContent("bold");
    expect(container.querySelector("p em")).toHaveTextContent("italic");
    expect(container.querySelector("blockquote")).toHaveTextContent("Quote");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Peer2Peer" })).toBeInTheDocument();
  });
});
