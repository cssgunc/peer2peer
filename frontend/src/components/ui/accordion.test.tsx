import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./accordion";

afterEach(cleanup);

function renderFaq() {
  render(
    <Accordion type="single" collapsible>
      <AccordionItem value="anonymous">
        <AccordionTrigger>Is this anonymous?</AccordionTrigger>
        <AccordionContent>Yes. We never ask for your name.</AccordionContent>
      </AccordionItem>
    </Accordion>,
  );
  return screen.getByRole("button", { name: "Is this anonymous?" });
}

describe("Accordion", () => {
  it("opens on click and sets aria-expanded", async () => {
    const user = userEvent.setup();
    const trigger = renderFaq();

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText(/never ask for your name/),
    ).not.toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region")).toHaveTextContent(
      "Yes. We never ask for your name.",
    );
  });

  it("opens on Enter and sets aria-expanded", async () => {
    const user = userEvent.setup();
    const trigger = renderFaq();

    await user.tab();
    expect(trigger).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/never ask for your name/)).toBeVisible();
  });
});
