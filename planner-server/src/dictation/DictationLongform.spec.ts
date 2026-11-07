import {
  BuildChunkPlan,
  BuildMeetingActions,
  ParseMeetingSummary,
  ParseSilenceDetectOutput,
  SplitSummaryChunks,
} from "./DictationLongform";

describe("BuildChunkPlan", () => {
  it("returns no chunk for an empty recording", () => {
    expect(BuildChunkPlan(0, [])).toEqual([]);
    expect(BuildChunkPlan(-5, [])).toEqual([]);
  });

  it("keeps a short recording in one chunk", () => {
    expect(BuildChunkPlan(12000, [])).toEqual([{ fromMs: 0, toMs: 12000 }]);
  });

  it("cuts near silences close to the target and covers the recording", () => {
    const chunks = BuildChunkPlan(
      120000,
      [
        { fromMs: 28000, toMs: 29500 },
        { fromMs: 58000, toMs: 59500 },
        { fromMs: 86000, toMs: 88000 },
      ],
      { targetMs: 30000, maxMs: 45000 },
    );

    expect(chunks.map((chunk) => [chunk.fromMs, chunk.toMs])).toEqual([
      [0, 28750],
      [28750, 58750],
      [58750, 87000],
      [87000, 120000],
    ]);
    expect(chunks[0].fromMs).toBe(0);
    expect(chunks[chunks.length - 1].toMs).toBe(120000);
    for (let index = 1; index < chunks.length; index++) {
      expect(chunks[index].fromMs).toBe(chunks[index - 1].toMs);
    }
  });

  it("never exceeds the maximum chunk length without a usable silence", () => {
    const chunks = BuildChunkPlan(100000, [], { targetMs: 30000, maxMs: 45000 });
    for (const chunk of chunks) {
      expect(chunk.toMs - chunk.fromMs).toBeLessThanOrEqual(45000);
    }
    expect(chunks.map((chunk) => chunk.toMs)).toEqual([45000, 90000, 100000]);
  });

  it("merges a tiny tail into the previous chunk", () => {
    const chunks = BuildChunkPlan(61000, [], {
      targetMs: 30000,
      maxMs: 45000,
    });
    expect(chunks).toEqual([{ fromMs: 0, toMs: 45000 }, { fromMs: 45000, toMs: 61000 }]);
  });

  it("ignores silences outside the recording", () => {
    const chunks = BuildChunkPlan(
      60000,
      [
        { fromMs: -1000, toMs: 0 },
        { fromMs: 60000, toMs: 61000 },
      ],
      { targetMs: 30000, maxMs: 45000 },
    );
    expect(chunks.map((chunk) => chunk.toMs)).toEqual([45000, 60000]);
  });
});

describe("ParseSilenceDetectOutput", () => {
  it("parses silence ranges from ffmpeg stderr", () => {
    const output = [
      "[silencedetect @ 0x1] silence_start: 12.5",
      "[silencedetect @ 0x1] silence_end: 13.75 | silence_duration: 1.25",
      "junk line",
      "[silencedetect @ 0x1] silence_start: 40",
      "[silencedetect @ 0x1] silence_end: 41.2",
    ].join("\n");
    expect(ParseSilenceDetectOutput(output)).toEqual([
      { fromMs: 12500, toMs: 13750 },
      { fromMs: 40000, toMs: 41200 },
    ]);
  });

  it("drops incomplete and inverted ranges", () => {
    const output =
      "silence_start: 5\nsilence_end: 4\nsilence_start: 10\nsilence_end: 12";
    expect(ParseSilenceDetectOutput(output)).toEqual([
      { fromMs: 5000, toMs: 4000 },
      { fromMs: 10000, toMs: 12000 },
    ].filter((silence) => silence.toMs > silence.fromMs));
  });

  it("returns nothing when the output has no markers", () => {
    expect(ParseSilenceDetectOutput("nothing here")).toEqual([]);
  });
});

describe("SplitSummaryChunks", () => {
  it("splits at paragraph boundaries within the limit", () => {
    expect(SplitSummaryChunks("aaa\nbbbb\ncc", 8)).toEqual(["aaa\nbbbb", "cc"]);
  });

  it("hard-slices a paragraph longer than the limit", () => {
    expect(SplitSummaryChunks("x".repeat(25), 10)).toEqual([
      "x".repeat(10),
      "x".repeat(10),
      "x".repeat(5),
    ]);
  });

  it("returns nothing for an empty transcript", () => {
    expect(SplitSummaryChunks("  \n ")).toEqual([]);
  });
});

describe("ParseMeetingSummary", () => {
  it("parses a strict JSON answer and strips code fences", () => {
    const summary = ParseMeetingSummary(
      '```json\n{"summary":"We met.","decisions":["Ship"],"actionItems":[{"title":"Do it","description":"Soon"}]}\n```',
    );
    expect(summary).toEqual({
      summary: "We met.",
      decisions: ["Ship"],
      actionItems: [{ title: "Do it", description: "Soon" }],
    });
  });

  it("extracts JSON surrounded by prose", () => {
    expect(
      ParseMeetingSummary('Here: {"summary":"S","decisions":[],"actionItems":[]} done'),
    ).toEqual({ summary: "S", decisions: [], actionItems: [] });
  });

  it("returns null for malformed answers", () => {
    expect(ParseMeetingSummary("not json")).toBeNull();
    expect(ParseMeetingSummary('{"summary":')).toBeNull();
  });

  it("drops incomplete action items and bounds arrays", () => {
    const items = Array.from({ length: 40 }, (_, index) => ({
      title: `Task ${index}`,
      description: "",
    }));
    const parsed = ParseMeetingSummary(
      JSON.stringify({
        summary: "S",
        decisions: [...Array.from({ length: 60 }, (_, i) => `D${i}`), 42],
        actionItems: [{ title: "" }, ...items],
      }),
    );
    expect(parsed?.decisions).toHaveLength(50);
    expect(parsed?.actionItems).toHaveLength(25);
    expect(parsed?.actionItems[0].title).toBe("Task 0");
  });
});

describe("BuildMeetingActions", () => {
  it("maps action items to create_task proposals with the project", () => {
    expect(
      BuildMeetingActions(
        [
          { title: "Write the spec", description: "By Friday" },
          { title: "Call the vendor", description: "" },
        ],
        "project-1",
      ),
    ).toEqual([
      {
        type: "create_task",
        title: "Write the spec",
        description: "By Friday",
        project: "project-1",
      },
      { type: "create_task", title: "Call the vendor", project: "project-1" },
    ]);
  });

  it("omits the project when the import had none", () => {
    expect(
      BuildMeetingActions([{ title: "Follow up", description: "" }], null),
    ).toEqual([{ type: "create_task", title: "Follow up" }]);
  });

  it("bounds the number of proposals", () => {
    const actions = BuildMeetingActions(
      Array.from({ length: 40 }, (_, index) => ({
        title: `Task ${index}`,
        description: "",
      })),
      null,
    );
    expect(actions).toHaveLength(25);
  });
});