// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Token contract consumed by common-web's LoginWithCodeCard,
// AuthorizeDeviceCard and LoginCodeInput (README "Theming and non-layer
// hosts"). Planner imports those SFCs directly, so it must define every
// token they read or they fall back to light-only values.
const CONSUMED_TOKENS = [
  "--color-surface",
  "--color-surface-raised",
  "--color-text",
  "--color-text-muted",
  "--color-border",
  "--color-primary",
  "--color-primary-hover",
  "--color-on-primary",
  "--color-warning",
  "--color-error",
  "--color-danger",
  "--color-success",
  "--space-xs",
  "--space-sm",
  "--space-base",
  "--space-md",
  "--space-lg",
  "--space-xl",
];

const css = readFileSync(
  fileURLToPath(new URL("../assets/css/tokens.css", import.meta.url)),
  "utf8",
);

function rootBlock(source: string): string {
  const match = source.match(/:root\s*\{([^}]*)\}/);
  if (!match?.[1]) throw new Error(":root block not found in tokens.css");
  return match[1];
}

function declarationCount(source: string, token: string): number {
  return source.match(new RegExp(`${token}\\s*:`, "g"))?.length ?? 0;
}

const root = rootBlock(css);

describe("Planner theme token contract", () => {
  it.each(CONSUMED_TOKENS)("defines %s in :root", (token) => {
    expect(root).toMatch(new RegExp(`${token}\\s*:`));
  });

  it("aliases the shared components' tokens onto Planner's palette", () => {
    expect(root).toMatch(
      /--color-surface-raised:\s*var\(--color-surface-hover\)/,
    );
    expect(root).toMatch(/--color-error:\s*var\(--color-danger\)/);
    expect(root).toMatch(/--space-base:\s*var\(--space-md\)/);
  });

  it("re-declares the aliased base tokens so they resolve per theme", () => {
    // --color-surface-hover and --color-danger live in :root and both dark
    // blocks, so the aliases above follow light/dark automatically.
    expect(
      declarationCount(css, "--color-surface-hover"),
    ).toBeGreaterThanOrEqual(2);
    expect(declarationCount(css, "--color-danger")).toBeGreaterThanOrEqual(2);
  });

  it("does not define --color-on-warning (warnings are --color-text callouts)", () => {
    expect(root).not.toMatch(/--color-on-warning\s*:/);
  });
});
