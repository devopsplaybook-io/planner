import {
  ParseCgroupV1CpuQuota,
  ParseCgroupV2CpuMax,
  ReadEffectiveCpuCount,
  ResolveWhisperThreads,
} from "./CpuLimits";

describe("ParseCgroupV2CpuMax", () => {
  it("should parse a quota and period pair", () => {
    expect(ParseCgroupV2CpuMax("100000 100000")).toBe(1);
    expect(ParseCgroupV2CpuMax("200000 100000")).toBe(2);
    expect(ParseCgroupV2CpuMax("150000 100000\n")).toBe(1.5);
  });

  it("should return null for an unlimited cgroup", () => {
    expect(ParseCgroupV2CpuMax("max 100000")).toBeNull();
  });

  it("should return null for malformed content", () => {
    expect(ParseCgroupV2CpuMax("")).toBeNull();
    expect(ParseCgroupV2CpuMax("100000")).toBeNull();
    expect(ParseCgroupV2CpuMax("abc 100000")).toBeNull();
    expect(ParseCgroupV2CpuMax("100000 0")).toBeNull();
    expect(ParseCgroupV2CpuMax("-1 100000")).toBeNull();
  });
});

describe("ParseCgroupV1CpuQuota", () => {
  it("should parse a quota and period pair", () => {
    expect(ParseCgroupV1CpuQuota("100000", "100000")).toBe(1);
    expect(ParseCgroupV1CpuQuota(200000, 100000)).toBe(2);
  });

  it("should default the period to 100 ms when missing", () => {
    expect(ParseCgroupV1CpuQuota("50000", null)).toBe(0.5);
  });

  it("should treat -1 and missing values as unlimited", () => {
    expect(ParseCgroupV1CpuQuota("-1", "100000")).toBeNull();
    expect(ParseCgroupV1CpuQuota(null, "100000")).toBeNull();
    expect(ParseCgroupV1CpuQuota(undefined, "100000")).toBeNull();
    expect(ParseCgroupV1CpuQuota("", "100000")).toBeNull();
  });

  it("should return null for non-numeric values", () => {
    expect(ParseCgroupV1CpuQuota("abc", "100000")).toBeNull();
    expect(ParseCgroupV1CpuQuota("100000", "abc")).toBeNull();
  });
});

describe("ReadEffectiveCpuCount", () => {
  it("should use the cgroup v2 limit when available", () => {
    const files: Record<string, string> = {
      "/sys/fs/cgroup/cpu.max": "100000 100000",
    };
    const effective = ReadEffectiveCpuCount({
      readFile: (filePath) => files[filePath] ?? null,
      cpuCount: () => 16,
    });
    expect(effective).toBe(1);
  });

  it("should fall back to the cgroup v1 quota", () => {
    const files: Record<string, string> = {
      "/proc/self/cgroup": "4:cpu,cpuacct:/kubepods/pod123\n",
      "/sys/fs/cgroup/cpu/kubepods/pod123/cpu.cfs_quota_us": "200000",
      "/sys/fs/cgroup/cpu/kubepods/pod123/cpu.cfs_period_us": "100000",
    };
    const effective = ReadEffectiveCpuCount({
      readFile: (filePath) => files[filePath] ?? null,
      cpuCount: () => 16,
    });
    expect(effective).toBe(2);
  });

  it("should fall back to the host CPU count without cgroup limits", () => {
    const effective = ReadEffectiveCpuCount({
      readFile: () => null,
      cpuCount: () => 8,
    });
    expect(effective).toBe(8);
  });

  it("should fall back when cpuCount throws", () => {
    const effective = ReadEffectiveCpuCount({
      readFile: () => null,
      cpuCount: () => {
        throw new Error("boom");
      },
    });
    expect(effective).toBe(1);
  });

  it("should ignore an unlimited v2 cgroup and use the v1 quota", () => {
    const files: Record<string, string> = {
      "/sys/fs/cgroup/cpu.max": "max 100000",
      "/proc/self/cgroup": "4:cpu:/kubepods/pod9\n",
      "/sys/fs/cgroup/cpu/kubepods/pod9/cpu.cfs_quota_us": "300000",
      "/sys/fs/cgroup/cpu/kubepods/pod9/cpu.cfs_period_us": "100000",
    };
    const effective = ReadEffectiveCpuCount({
      readFile: (filePath) => files[filePath] ?? null,
      cpuCount: () => 16,
    });
    expect(effective).toBe(3);
  });
});

describe("ResolveWhisperThreads", () => {
  it("should use one thread at a 1-CPU cgroup limit", () => {
    expect(ResolveWhisperThreads(1, 0)).toBe(1);
  });

  it("should use the floor of a fractional CPU allowance", () => {
    expect(ResolveWhisperThreads(1.5, 0)).toBe(1);
    expect(ResolveWhisperThreads(2.9, 0)).toBe(2);
  });

  it("should clamp the automatic value to the maximum", () => {
    expect(ResolveWhisperThreads(32, 0)).toBe(4);
    expect(ResolveWhisperThreads(8, 0, 6)).toBe(6);
  });

  it("should let an explicit configuration win, clamped", () => {
    expect(ResolveWhisperThreads(1, 2)).toBe(2);
    expect(ResolveWhisperThreads(1, 10)).toBe(4);
    expect(ResolveWhisperThreads(8, 1)).toBe(1);
  });

  it("should default to one thread for invalid inputs", () => {
    expect(ResolveWhisperThreads(0, 0)).toBe(1);
    expect(ResolveWhisperThreads(Number.NaN, 0)).toBe(1);
    expect(ResolveWhisperThreads(-2, -1)).toBe(1);
  });
});
