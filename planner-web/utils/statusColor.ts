// Light text on dark fills, dark text on light fills (picker shades range
// from very light to very dark), so colored chips stay readable
export function readableTextColor(hex: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!match) return "#ffffff";
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? "#1f2937" : "#ffffff";
}
