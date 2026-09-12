import { seedStatusOrder } from "./StatusesData";

describe("seedStatusOrder", () => {
  it("should seed To Do, In Progress, Done when there are no projects", () => {
    expect(seedStatusOrder([])).toEqual(["To Do", "In Progress", "Done"]);
    expect(seedStatusOrder([[]])).toEqual(["To Do", "In Progress", "Done"]);
  });

  it("should preserve To Do, In Progress, Done for default projects", () => {
    expect(seedStatusOrder([["To Do", "In Progress", "Done"]])).toEqual([
      "To Do",
      "In Progress",
      "Done",
    ]);
  });

  it("should deduplicate statuses across projects and force Done last", () => {
    expect(
      seedStatusOrder([
        ["Backlog", "To Do", "Done"],
        ["To Do", "In Progress", "Done"],
      ]),
    ).toEqual(["To Do", "In Progress", "Backlog", "Done"]);
  });

  it("should always include Done even when no project has it", () => {
    expect(seedStatusOrder([["To Do"]])).toEqual(["To Do", "In Progress", "Done"]);
  });
});
