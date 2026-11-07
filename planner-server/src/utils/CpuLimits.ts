import * as fs from "fs";
import * as os from "os";

/**
 * The embedded whisper.cpp engine must not size its thread pool from the
 * host CPU count: inside a container the cgroup limit is what the process
 * can actually use, and oversubscribing it (4 threads on a 1-CPU limit)
 * slows the transcription down and starves the event loop. These helpers
 * read the effective allowance (cgroup v2, then cgroup v1, then os.cpus())
 * and clamp the thread count to it.
 */

/** Parses the cgroup v2 `cpu.max` file ("<quota> <period>" or "max <period>"). */
export function ParseCgroupV2CpuMax(content: string): number | null {
  const parts = content.trim().split(/\s+/);
  if (parts.length < 2) {
    return null;
  }
  if (parts[0] === "max") {
    return null;
  }
  const quota = Number(parts[0]);
  const period = Number(parts[1]);
  if (
    !Number.isFinite(quota) ||
    !Number.isFinite(period) ||
    quota <= 0 ||
    period <= 0
  ) {
    return null;
  }
  return quota / period;
}

/**
 * Parses the cgroup v1 quota/period pair. A quota of "-1" means unlimited.
 */
export function ParseCgroupV1CpuQuota(
  quota: string | number | null | undefined,
  period: string | number | null | undefined,
): number | null {
  if (quota === null || quota === undefined) {
    return null;
  }
  const quotaValue = String(quota).trim();
  if (quotaValue === "-1" || quotaValue === "") {
    return null;
  }
  const quotaNumber = Number(quotaValue);
  const periodNumber = period === null || period === undefined
    ? 100000
    : Number(String(period).trim());
  if (
    !Number.isFinite(quotaNumber) ||
    !Number.isFinite(periodNumber) ||
    quotaNumber <= 0 ||
    periodNumber <= 0
  ) {
    return null;
  }
  return quotaNumber / periodNumber;
}

export interface CpuLimitOptions {
  /** Injected file reader (tests); returns null when the file is absent. */
  readFile?: (filePath: string) => string | null;
  /** Injected host CPU count (tests). */
  cpuCount?: () => number;
}

function defaultReadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/** Reads the cgroup controller path for the current process (v1 layout). */
function cgroupV1CpuPath(readFile: (p: string) => string | null): string {
  const self = readFile("/proc/self/cgroup");
  if (self) {
    for (const line of self.split("\n")) {
      const parts = line.split(":");
      if (parts.length === 3 && parts[1].split(",").includes("cpu")) {
        const relative = parts[2].trim();
        return `/sys/fs/cgroup/cpu${relative === "/" ? "" : relative}`;
      }
    }
  }
  return "/sys/fs/cgroup/cpu";
}

/**
 * Returns the effective CPU allowance: cgroup v2 `cpu.max`, then cgroup v1
 * `cpu.cfs_quota_us`/`cpu.cfs_period_us`, then the host CPU count. Never
 * throws.
 */
export function ReadEffectiveCpuCount(options: CpuLimitOptions = {}): number {
  const readFile = options.readFile ?? defaultReadFile;
  const cpuCount = options.cpuCount ?? (() => os.cpus().length || 1);

  const v2 = readFile("/sys/fs/cgroup/cpu.max");
  if (v2 !== null) {
    const parsed = ParseCgroupV2CpuMax(v2);
    if (parsed !== null) {
      return parsed;
    }
  }

  const cpuDir = cgroupV1CpuPath(readFile);
  const v1Quota = readFile(`${cpuDir}/cpu.cfs_quota_us`);
  const v1Period = readFile(`${cpuDir}/cpu.cfs_period_us`);
  if (v1Quota !== null) {
    const parsed = ParseCgroupV1CpuQuota(v1Quota, v1Period);
    if (parsed !== null) {
      return parsed;
    }
  }

  try {
    return cpuCount() || 1;
  } catch {
    return 1;
  }
}

/**
 * Resolves the whisper.cpp thread count: an explicit positive value wins
 * (clamped 1..max), otherwise the floor of the effective CPU allowance
 * (at a 1-CPU cgroup limit this is 1, never the host count).
 */
export function ResolveWhisperThreads(
  effectiveCpus: number,
  configuredThreads: number,
  max = 4,
): number {
  if (Number.isFinite(configuredThreads) && configuredThreads > 0) {
    return Math.max(1, Math.min(max, Math.floor(configuredThreads)));
  }
  const cpus =
    Number.isFinite(effectiveCpus) && effectiveCpus > 0 ? effectiveCpus : 1;
  return Math.max(1, Math.min(max, Math.floor(cpus)));
}
