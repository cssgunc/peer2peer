import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import type { Resource, ResourceTag } from "./ResourceCard";
import ResourceFilter from "./ResourceFilter";

afterEach(() => {
  cleanup();
});

function makeResource(overrides: Partial<Resource>): Resource {
  return {
    id: crypto.randomUUID(),
    name: "Resource",
    description: "",
    url: null,
    phone: null,
    is_unc: false,
    is_crisis: false,
    tags: [],
    ...overrides,
  };
}

// Each fixture differs on purpose so every filter has something to remove.
const resources: Resource[] = [
  makeResource({
    name: "CAPS",
    description: "Walk-in counseling for UNC students.",
    is_unc: true,
    tags: ["Ongoing Care"],
  }),
  makeResource({
    name: "988 Lifeline",
    description: "Call or text 988 any time.",
    tags: ["Crisis/Urgent"],
  }),
  makeResource({
    name: "Women's Center",
    description: "Confidential advocacy for UNC students.",
    is_unc: true,
    tags: ["Crisis/Urgent", "Advocacy"],
  }),
  makeResource({
    name: "Trevor Project",
    description: "Free, confidential support for LGBTQ+ young people.",
    tags: ["Peer & Community"],
  }),
];

const tags: ResourceTag[] = [
  "Ongoing Care",
  "Crisis/Urgent",
  "Advocacy",
  "Peer & Community",
].map((name) => ({ id: crypto.randomUUID(), name }));

function setup() {
  render(<ResourceFilter resources={resources} tags={tags} />);
  return { user: userEvent.setup() };
}

function shownNames() {
  return screen
    .queryAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent);
}

it("finds a resource by a word that is only in its description", async () => {
  const { user } = setup();

  await user.type(screen.getByRole("searchbox"), "WALK-IN");

  expect(shownNames()).toEqual(["CAPS"]);
});

it("hides resources without the selected tag", async () => {
  const { user } = setup();

  await user.click(screen.getByRole("button", { name: "Crisis/Urgent" }));

  expect(shownNames()).toEqual(["988 Lifeline", "Women's Center"]);
});

it("shows resources that have any of the selected tags", async () => {
  const { user } = setup();

  await user.click(screen.getByRole("button", { name: "Ongoing Care" }));
  await user.click(screen.getByRole("button", { name: "Peer & Community" }));

  expect(shownNames()).toEqual(["CAPS", "Trevor Project"]);
});

it("hides national resources when UNC is selected", async () => {
  const { user } = setup();

  await user.click(screen.getByRole("radio", { name: "UNC" }));

  expect(shownNames()).toEqual(["CAPS", "Women's Center"]);
});

it("applies a tag and a search term together", async () => {
  const { user } = setup();

  // "confidential" matches Women's Center and Trevor Project;
  // Crisis/Urgent matches 988 Lifeline and Women's Center.
  await user.click(screen.getByRole("button", { name: "Crisis/Urgent" }));
  await user.type(screen.getByRole("searchbox"), "confidential");

  expect(shownNames()).toEqual(["Women's Center"]);
});

it("shows the empty state and clears every filter", async () => {
  const { user } = setup();

  const chip = screen.getByRole("button", { name: "Advocacy" });
  await user.click(chip);
  await user.click(screen.getByRole("radio", { name: "National" }));
  await user.type(screen.getByRole("searchbox"), "zzz");

  expect(screen.getByText("No resources match")).toBeInTheDocument();
  expect(shownNames()).toEqual([]);

  await user.click(screen.getByRole("button", { name: "Clear filters" }));

  expect(shownNames()).toEqual([
    "CAPS",
    "988 Lifeline",
    "Women's Center",
    "Trevor Project",
  ]);
  expect(screen.getByRole("searchbox")).toHaveValue("");
  expect(chip).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("radio", { name: "All" })).toBeChecked();
});
