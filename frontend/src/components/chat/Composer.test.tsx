import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import Composer from "./Composer";

afterEach(cleanup);

function setup(disabled = false) {
  const onSend = vi.fn();
  render(<Composer onSend={onSend} disabled={disabled} />);
  const box = screen.getByRole("textbox", { name: "Message" });
  return { onSend, box, user: userEvent.setup() };
}

describe("Composer", () => {
  it("sends on Enter and clears the box", async () => {
    const { onSend, box, user } = setup();
    await user.type(box, "hello{Enter}");
    expect(onSend).toHaveBeenCalledWith("hello");
    expect(box).toHaveValue("");
  });

  it("adds a new line on Shift+Enter without sending", async () => {
    const { onSend, box, user } = setup();
    await user.type(box, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue("line one\nline two");
  });

  it("does not send blank messages", async () => {
    const { onSend, box, user } = setup();
    await user.type(box, "   {Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("caps input at 2,000 characters", () => {
    const { box } = setup();
    expect(box).toHaveAttribute("maxLength", "2000");
  });

  it("shows the counter only near the limit", () => {
    const { box } = setup();
    fireEvent.change(box, { target: { value: "a".repeat(100) } });
    expect(screen.queryByText(/\/ 2,000/)).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: "a".repeat(1_900) } });
    expect(screen.getByText("1,900 / 2,000")).toBeInTheDocument();
  });

  it("is disabled once the conversation has ended", async () => {
    const { onSend, box, user } = setup(true);
    expect(box).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await user.type(box, "hello{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });
});
