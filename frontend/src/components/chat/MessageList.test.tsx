import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import MessageList from "./MessageList";

afterEach(cleanup);

describe("MessageList", () => {
  it("renders message bodies as plain text", () => {
    const body = "<b>hi</b> **bold** [link](https://example.com)";
    const { container } = render(
      <MessageList
        messages={[
          {
            id: "m1",
            sender: "responder",
            body,
            created_at: "2026-10-19T16:00:00Z",
          },
        ]}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(container.querySelector("b, strong, a")).toBeNull();
  });
});
