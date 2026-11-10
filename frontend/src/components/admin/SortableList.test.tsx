import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SortableList } from "./SortableList";

afterEach(cleanup);

const items = [
  { id: "a", question: "How do I start?" },
  { id: "b", question: "Is it anonymous?" },
  { id: "c", question: "When are you open?" },
];

function renderList(onReorder = vi.fn()) {
  render(
    <SortableList
      items={items}
      getId={(item) => item.id}
      getLabel={(item) => item.question}
      onReorder={onReorder}
    />,
  );
  return onReorder;
}

describe("SortableList", () => {
  it("passes the new order to onReorder when an item moves", async () => {
    const onReorder = renderList();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Move 'Is it anonymous?' up" }),
    );
    expect(onReorder).toHaveBeenLastCalledWith(["b", "a", "c"]);

    await user.click(
      screen.getByRole("button", { name: "Move 'Is it anonymous?' down" }),
    );
    expect(onReorder).toHaveBeenLastCalledWith(["a", "c", "b"]);
  });

  it("works from the keyboard", async () => {
    const onReorder = renderList();
    const user = userEvent.setup();

    screen.getByRole("button", { name: "Move 'How do I start?' down" }).focus();
    await user.keyboard("{Enter}");
    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
  });

  it("disables the first item's up button and the last item's down button", () => {
    renderList();

    expect(
      screen.getByRole("button", { name: "Move 'How do I start?' up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move 'How do I start?' down" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Move 'When are you open?' up" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Move 'When are you open?' down" }),
    ).toBeDisabled();
  });
});
