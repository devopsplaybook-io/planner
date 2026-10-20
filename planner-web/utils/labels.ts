// Labels managed by automation rather than people: the LLM agent sets the
// transient agent:running state and accumulates model:<model> provenance.
export const MACHINE_LABEL_PREFIXES = ["agent:", "model:"];

export function isMachineLabel(name: string): boolean {
  return MACHINE_LABEL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Parse the ?labels= comma-separated filter (trim, drop empty, dedupe). */
export function parseLabelQuery(value: unknown): string[] {
  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }
  const labels: string[] = [];
  for (const part of value.split(",")) {
    const label = part.trim();
    if (label && !labels.includes(label)) {
      labels.push(label);
    }
  }
  return labels;
}

/** Serialize the label filter for the URL; undefined removes the param. */
export function serializeLabelQuery(labels: string[]): string | undefined {
  return labels.length > 0 ? labels.join(",") : undefined;
}
