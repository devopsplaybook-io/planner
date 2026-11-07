import { formatLocalDate } from "../utils/DateUtils";
import {
  ACTIONS_SYSTEM_PROMPT,
  BuildActionsPrompt,
  BuildPolishPrompt,
  ParseActionProposals,
  ParsePolishedText,
  POLISH_SYSTEM_PROMPT,
} from "./DictationLlm";

describe("BuildPolishPrompt", () => {
  it("should include the transcript", () => {
    const prompt = BuildPolishPrompt("hello world", null);
    expect(prompt).toContain("hello world");
  });

  it("should mention the language when one is set", () => {
    const prompt = BuildPolishPrompt("bonjour", "fr");
    expect(prompt).toContain('"fr"');
  });

  it("should not mention a language in auto mode", () => {
    const prompt = BuildPolishPrompt("hello", null);
    expect(prompt).not.toContain("language");
  });
});

describe("BuildActionsPrompt", () => {
  it("should include the text", () => {
    const prompt = BuildActionsPrompt("Buy milk tomorrow", null);
    expect(prompt).toContain("Buy milk tomorrow");
  });

  it("should mention the language when one is set", () => {
    const prompt = BuildActionsPrompt("Acheter du lait", "fr");
    expect(prompt).toContain('"fr"');
  });

  it("should include the date from the provided now", () => {
    const prompt = BuildActionsPrompt("Buy milk", null, new Date(2026, 9, 6));
    expect(prompt).toContain("2026-10-06");
  });

  it("should default to the current local date", () => {
    const prompt = BuildActionsPrompt("Buy milk", null);
    expect(prompt).toContain(formatLocalDate(new Date()));
  });
});

describe("system prompts", () => {
  it("should request strict JSON for both calls", () => {
    expect(POLISH_SYSTEM_PROMPT).toContain("strict JSON");
    expect(ACTIONS_SYSTEM_PROMPT).toContain("strict JSON");
  });

  it("should cap the number of actions in the actions prompt", () => {
    expect(ACTIONS_SYSTEM_PROMPT).toContain("at most 10");
  });

  it("should resolve relative due dates against the current date", () => {
    expect(ACTIONS_SYSTEM_PROMPT).toContain("current date");
  });
});

describe("ParsePolishedText", () => {
  it("should parse a strict JSON response", () => {
    expect(ParsePolishedText('{"text": "Hello world!"}')).toBe("Hello world!");
  });

  it("should parse JSON wrapped in markdown code fences", () => {
    expect(ParsePolishedText('```json\n{"text": "Hello"}\n```')).toBe("Hello");
  });

  it("should parse JSON embedded in surrounding prose", () => {
    expect(
      ParsePolishedText('Here you go:\n{"text": "Hello"}\nDone!'),
    ).toBe("Hello");
  });

  it("should trim the polished text", () => {
    expect(ParsePolishedText('{"text": "  Hello  "}')).toBe("Hello");
  });

  it("should return null on malformed output", () => {
    expect(ParsePolishedText("not json at all")).toBeNull();
    expect(ParsePolishedText("")).toBeNull();
    expect(ParsePolishedText("{}")).toBeNull();
    expect(ParsePolishedText('{"text": ""}')).toBeNull();
    expect(ParsePolishedText('{"text": 42}')).toBeNull();
    expect(ParsePolishedText("[1, 2, 3]")).toBeNull();
  });
});

describe("ParseActionProposals", () => {
  it("should parse valid proposals", () => {
    const content =
      '{"actions": [' +
      '{"type": "create_task", "title": "Buy milk", "description": "2 liters", "priority": "high", "dueDate": "2026-10-07"},' +
      '{"type": "create_note", "title": "Groceries", "description": "milk, bread"}]}';
    expect(ParseActionProposals(content)).toEqual([
      {
        type: "create_task",
        title: "Buy milk",
        description: "2 liters",
        priority: "high",
        dueDate: "2026-10-07",
      },
      {
        type: "create_note",
        title: "Groceries",
        description: "milk, bread",
      },
    ]);
  });

  it("should parse proposals wrapped in markdown code fences", () => {
    const content = '```json\n{"actions": [{"type": "create_note", "title": "T"}]}\n```';
    expect(ParseActionProposals(content)).toEqual([
      { type: "create_note", title: "T", description: "" },
    ]);
  });

  it("should return an empty array when nothing is actionable", () => {
    expect(ParseActionProposals('{"actions": []}')).toEqual([]);
  });

  it("should clamp the proposals to 10 entries", () => {
    const entries = Array.from(
      { length: 15 },
      (_, i) => `{"type": "create_task", "title": "Task ${i}"}`,
    ).join(",");
    const proposals = ParseActionProposals(`{"actions": [${entries}]}`);
    expect(proposals).toHaveLength(10);
  });

  it("should parse schema v2 actions and flatten create_multiple", () => {
    const content =
      '{"actions": [' +
      '{"type": "update_task", "target": "task-1", "changes": {"status": "Done"}},' +
      '{"type": "add_comment", "target": "task-1", "text": "Looks good"},' +
      '{"type": "create_multiple", "actions": [' +
      '{"type": "create_task", "title": "One"},' +
      '{"type": "create_note", "title": "Two"}]}]}';
    expect(ParseActionProposals(content)).toEqual([
      {
        type: "update_task",
        target: "task-1",
        changes: { status: "Done" },
      },
      { type: "add_comment", target: "task-1", targetType: "task", text: "Looks good" },
      { type: "create_task", title: "One", description: "" },
      { type: "create_note", title: "Two", description: "" },
    ]);
  });

  it("should reject v2 actions without their required fields", () => {
    const content =
      '{"actions": [' +
      '{"type": "update_task", "target": "task-1"},' +
      '{"type": "add_comment", "text": "orphan"},' +
      '{"type": "add_checklist_items", "target": "task-1", "items": []}]}';
    expect(ParseActionProposals(content)).toEqual([]);
  });

  it("should drop entries with an unknown type or an empty title", () => {
    const content =
      '{"actions": [' +
      '{"type": "delete_all", "title": "Bad"},' +
      '{"type": "create_task", "title": "  "},' +
      '{"type": "create_task", "title": "Good"}]}';
    expect(ParseActionProposals(content)).toEqual([
      { type: "create_task", title: "Good", description: "" },
    ]);
  });

  it("should drop invalid priority and dueDate values", () => {
    const content =
      '{"actions": [{"type": "create_task", "title": "T", "priority": "urgent", "dueDate": "tomorrow"}]}';
    expect(ParseActionProposals(content)).toEqual([
      { type: "create_task", title: "T", description: "" },
    ]);
  });

  it("should return null on malformed output", () => {
    expect(ParseActionProposals("not json at all")).toBeNull();
    expect(ParseActionProposals("")).toBeNull();
    expect(ParseActionProposals("{}")).toBeNull();
    expect(ParseActionProposals('{"actions": "nope"}')).toBeNull();
    expect(ParseActionProposals('{"actions": [1, 2]}')).toEqual([]);
  });
});
