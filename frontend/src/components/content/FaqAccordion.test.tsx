import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import FaqAccordion, { type Faq } from "./FaqAccordion";

afterEach(cleanup);

const faqs: Faq[] = [
  {
    id: "getting-started-1",
    category: "Getting started",
    question: "How do I start?",
    answer_md:
      "Choose **Text Us** to start. [Read more](https://example.edu/guide).",
  },
  {
    id: "hours-1",
    category: "Availability",
    question: "When can I reach out?",
    answer_md: "See our opening hours.",
  },
  {
    id: "getting-started-2",
    category: "Getting started",
    question: "What can I talk about?",
    answer_md: "Everyday stress and whatever is on your mind.",
  },
];

describe("FaqAccordion", () => {
  it("groups questions in the order categories first appear and keeps question order", () => {
    render(<FaqAccordion faqs={faqs} />);
    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(["Getting started", "Availability"]);
    const gettingStarted = within(
      screen.getByRole("region", { name: "Getting started" }),
    );
    expect(
      gettingStarted.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["How do I start?", "What can I talk about?"]);
    expect(
      within(screen.getByRole("region", { name: "Availability" })).getByRole(
        "button",
        { name: "When can I reach out?" },
      ),
    ).toBeInTheDocument();
  });

  it("opens and closes a question with the keyboard", async () => {
    const user = userEvent.setup();
    render(<FaqAccordion faqs={faqs} />);
    const trigger = screen.getByRole("button", { name: "How do I start?" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Read more" })).toBeVisible();
    await user.keyboard(" ");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("renders answers through the safe Markdown component", async () => {
    const user = userEvent.setup();
    render(
      <FaqAccordion
        faqs={[
          {
            ...faqs[0],
            answer_md:
              faqs[0].answer_md +
              '\n\n<script>alert("unsafe")</script><img src="x" />',
          },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "How do I start?" }));
    expect(screen.getByText("Text Us", { selector: "strong" })).toBeVisible();
    const link = screen.getByRole("link", { name: "Read more" });
    expect(link).toHaveAttribute("href", "https://example.edu/guide");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  it("allows questions in separate categories to stay open together", async () => {
    const user = userEvent.setup();
    render(<FaqAccordion faqs={faqs} />);
    const start = screen.getByRole("button", { name: "How do I start?" });
    const hours = screen.getByRole("button", { name: "When can I reach out?" });
    await user.click(start);
    await user.click(hours);
    expect(start).toHaveAttribute("aria-expanded", "true");
    expect(hours).toHaveAttribute("aria-expanded", "true");
  });

  it("renders no section or heading when there are no published FAQs", () => {
    const { container } = render(<FaqAccordion faqs={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
