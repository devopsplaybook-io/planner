import axios from "axios";

// Mock dependencies
jest.mock("axios");

const mockAxios = axios as jest.Mocked<typeof axios>;

import {
  BuildImprovePrompt,
  ParseImprovedText,
  TaskImproveInit,
  TaskImproveText,
} from "./TaskImprove";
import { Config } from "../Config";

describe("BuildImprovePrompt", () => {
  it("should include the title and description", () => {
    const prompt = BuildImprovePrompt(
      "Fix login",
      "Session drops after 5 minutes",
    );
    expect(prompt).toContain("Fix login");
    expect(prompt).toContain("Session drops after 5 minutes");
  });

  it("should tolerate an empty title or description", () => {
    const prompt = BuildImprovePrompt("", "");
    expect(prompt).toContain("(empty)");
  });
});

describe("ParseImprovedText", () => {
  it("should parse a strict JSON response", () => {
    expect(ParseImprovedText('{"title": "T", "description": "D"}')).toEqual({
      title: "T",
      description: "D",
    });
  });

  it("should parse JSON wrapped in markdown code fences", () => {
    expect(
      ParseImprovedText('```json\n{"title": "T", "description": "D"}\n```'),
    ).toEqual({ title: "T", description: "D" });
  });

  it("should parse JSON embedded in surrounding prose", () => {
    expect(
      ParseImprovedText('Here you go:\n{"title": "T", "description": "D"}\nDone!'),
    ).toEqual({ title: "T", description: "D" });
  });

  it("should trim the parsed fields", () => {
    expect(
      ParseImprovedText('{"title": "  T  ", "description": " D\\n"}'),
    ).toEqual({ title: "T", description: "D" });
  });

  it("should keep a missing field as an empty string for the caller to fall back on", () => {
    expect(ParseImprovedText('{"description": "D"}')).toEqual({
      title: "",
      description: "D",
    });
  });

  it("should return null on malformed output", () => {
    expect(ParseImprovedText("not json at all")).toBeNull();
    expect(ParseImprovedText("")).toBeNull();
    expect(ParseImprovedText("{}")).toBeNull();
    expect(ParseImprovedText("[1, 2, 3]")).toBeNull();
  });
});

describe("TaskImproveText", () => {
  let config: Config;

  beforeEach(async () => {
    jest.clearAllMocks();

    config = new Config();
    config.LLM_API_KEY = "test-key";
    config.LLM_API_URL = "https://api.test.com/chat";
    config.LLM_MODEL = "test-model";
    await TaskImproveInit(config);
  });

  it("should call the LLM and return the improved text", async () => {
    mockAxios.post.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content:
                '{"title": "Improved title", "description": "Improved description"}',
            },
          },
        ],
      },
    });

    const result = await TaskImproveText("Old title", "Old description");

    expect(result).toEqual({
      title: "Improved title",
      description: "Improved description",
    });
    expect(mockAxios.post).toHaveBeenCalledWith(
      "https://api.test.com/chat",
      expect.objectContaining({
        model: "test-model",
        temperature: 0.3,
        max_tokens: 1000,
        messages: [
          { role: "system", content: expect.stringContaining("strict JSON") },
          { role: "user", content: expect.stringContaining("Old title") },
        ],
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    );
  });

  it("should return null when the LLM response is malformed", async () => {
    mockAxios.post.mockResolvedValue({
      data: {
        choices: [{ message: { content: "I cannot help with that" } }],
      },
    });

    const result = await TaskImproveText("Old title", "Old description");
    expect(result).toBeNull();
  });

  it("should propagate LLM API failures to the caller", async () => {
    mockAxios.post.mockRejectedValue(
      Object.assign(new Error("bad request"), {
        response: { status: 400 },
      }),
    );

    await expect(TaskImproveText("Old title", "Old description")).rejects.toThrow(
      "bad request",
    );
  });
});
