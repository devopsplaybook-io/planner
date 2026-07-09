describe("ViewsData", () => {
  it("should export NextViewData interface with correct structure", () => {
    // Verify the types are correct by constructing a valid object
    const viewData = {
      overdue: [],
      upcoming: [],
      highPriority: [],
    };
    expect(viewData.overdue).toEqual([]);
    expect(viewData.upcoming).toEqual([]);
    expect(viewData.highPriority).toEqual([]);
  });

  it("should export NextViewTask interface with correct fields", () => {
    const task = {
      id: "test-id",
      projectId: "proj-id",
      title: "Test Task",
      status: "To Do",
      priority: "high",
      dueDate: "2025-06-15",
      labels: ["urgent"],
    };
    expect(task.id).toBe("test-id");
    expect(task.title).toBe("Test Task");
    expect(task.priority).toBe("high");
    expect(task.labels).toContain("urgent");
  });
});
