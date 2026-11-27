import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ImpactStats from "./ImpactStats";

afterEach(cleanup);

describe("ImpactStats", () => {
  it("renders nothing when no statistics are published", () => {
    const { container } = render(<ImpactStats stats={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows each value with its label, in the order given", () => {
    render(
      <ImpactStats
        stats={[
          { id: "a", label: "Conversations this semester", value: "120+" },
          { id: "b", label: "Trained responders", value: "24" },
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Our impact" }),
    ).toBeInTheDocument();
    const labels = screen.getAllByRole("term").map((term) => term.textContent);
    const values = screen
      .getAllByRole("definition")
      .map((value) => value.textContent);
    expect(labels).toEqual([
      "Conversations this semester",
      "Trained responders",
    ]);
    expect(values).toEqual(["120+", "24"]);
  });
});
