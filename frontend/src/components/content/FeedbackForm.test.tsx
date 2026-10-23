import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import FeedbackForm from "./FeedbackForm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(response = new Response(null, { status: 204 })) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  render(<FeedbackForm />);
  const box = screen.getByRole("textbox", { name: "Your feedback" });
  const submit = screen.getByRole("button", { name: "Submit" });
  return { fetchMock, box, submit, user: userEvent.setup() };
}

describe("FeedbackForm", () => {
  it("posts only the trimmed feedback body without credentials", async () => {
    const { fetchMock, box, submit, user } = setup();
    await user.type(box, "  More evening hours, please.  ");
    await user.click(submit);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ body: "More evening hours, please." }),
    });
  });

  it("clears the text and thanks the sender after a 204 response", async () => {
    const { box, submit, user } = setup();
    await user.type(box, "Thank you for listening.");
    await user.click(submit);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Thank you for your feedback!",
    );
    expect(box).toHaveValue("");
    expect(submit).toBeDisabled();
  });

  it("shows the rate-limit message and keeps the text on 429", async () => {
    const { box, submit, user } = setup(new Response(null, { status: 429 }));
    await user.type(box, "Please keep this feedback.");
    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many submissions. Try again later.",
    );
    expect(box).toHaveValue("Please keep this feedback.");
    expect(submit).toBeEnabled();
  });

  it.each([422, 500, 502])(
    "shows a generic error for HTTP %s",
    async (status) => {
      const { box, submit, user } = setup(
        new Response(JSON.stringify({ detail: "Private server details" }), {
          status,
        }),
      );
      await user.type(box, "Some feedback");
      await user.click(submit);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Something went wrong. Please try again later.",
      );
      expect(
        screen.queryByText(/Private server details/),
      ).not.toBeInTheDocument();
      expect(box).toHaveValue("Some feedback");
    },
  );

  it("allows a retry after a network failure", async () => {
    const { fetchMock, box, submit, user } = setup();
    fetchMock.mockRejectedValueOnce(new TypeError("Network unavailable"));
    await user.type(box, "Some feedback");
    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong. Please try again later.",
    );
    expect(box).toHaveValue("Some feedback");
    await user.click(submit);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Thank you for your feedback!",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("prevents empty and whitespace-only submissions", async () => {
    const { fetchMock, box, submit, user } = setup();
    expect(submit).toBeDisabled();
    await user.click(submit);
    await user.type(box, "   ");
    expect(submit).toBeDisabled();
    fireEvent.submit(box.closest("form")!);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("limits feedback to 2,000 characters and shows the counter near the limit", async () => {
    const { fetchMock, box, submit, user } = setup();
    expect(box).toHaveAttribute("maxlength", "2000");
    fireEvent.change(box, { target: { value: "a".repeat(1_799) } });
    expect(screen.queryByText(/\/ 2,000/)).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: "a".repeat(1_800) } });
    expect(screen.getByText("1,800 / 2,000")).toBeInTheDocument();
    expect(box).toHaveAttribute(
      "aria-describedby",
      "feedback-privacy feedback-count",
    );
    fireEvent.change(box, { target: { value: "a".repeat(2_000) } });
    await user.type(box, "b");
    expect(box).toHaveValue("a".repeat(2_000));
    expect(screen.getByText("2,000 / 2,000")).toBeInTheDocument();
    expect(submit).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disables the form while the submission is in progress", async () => {
    const { fetchMock, box, submit, user } = setup();
    const request = Promise.withResolvers<Response>();
    fetchMock.mockReturnValueOnce(request.promise);
    await user.type(box, "Some feedback");
    await user.click(submit);

    expect(box).toBeDisabled();
    expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();
    fireEvent.submit(box.closest("form")!);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => request.resolve(new Response(null, { status: 204 })));
    expect(box).toBeEnabled();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("explains anonymity and collects only feedback", () => {
    setup();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(
      screen.getByText("We don't collect your name, email, or IP address"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/name|email/i)).not.toBeInTheDocument();
  });
});
