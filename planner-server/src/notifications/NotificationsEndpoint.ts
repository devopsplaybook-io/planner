import * as net from "net";

/**
 * Push subscription endpoints are supplied by any authenticated user and the
 * server POSTs to them on every reminder run: only a public HTTPS URL is
 * accepted, so the endpoint cannot turn the server into an SSRF proxy.
 *
 * Hostname/IP-shape checks only: a hostname that resolves to a private address
 * through DNS is not detected here (see docs/specs/NOTIFICATIONS.md).
 */
export function NotificationsEndpointNormalize(
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") {
    return null;
  }
  if (url.username || url.password) {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) {
    return null;
  }
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "local" ||
    hostname.endsWith(".local") ||
    hostname === "internal" ||
    hostname.endsWith(".internal")
  ) {
    return null;
  }

  const ipLiteral = hostname.replace(/^\[|\]$/g, "");
  if (net.isIPv4(ipLiteral)) {
    return isBlockedIPv4(ipLiteral) ? null : trimmed;
  }
  if (net.isIPv6(ipLiteral)) {
    return isBlockedIPv6(ipLiteral) ? null : trimmed;
  }

  return trimmed;
}

function isBlockedIPv4(ip: string): boolean {
  const octets = ip.split(".").map((part) => parseInt(part, 10));
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o))) {
    return true;
  }
  const [a, b, c] = octets;
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10.0.0.0/8
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10
    a === 127 || // 127.0.0.0/8
    (a === 169 && b === 254) || // 169.254.0.0/16
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24
    (a === 192 && b === 0 && c === 2) || // 192.0.2.0/24
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15
    (a === 198 && b === 51 && c === 100) || // 198.51.100.0/24
    (a === 203 && b === 0 && c === 113) || // 203.0.113.0/24
    a >= 224 // multicast (224.0.0.0/4) and reserved (240.0.0.0/4)
  );
}

function isBlockedIPv6(ip: string): boolean {
  const groups = expandIPv6(ip);
  if (!groups) {
    return true;
  }

  const embeddedIPv4 = () =>
    [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(
      ".",
    );

  // IPv4-mapped ::ffff:0:0/96
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return isBlockedIPv4(embeddedIPv4());
  }
  // IPv4-compatible ::/96 (deprecated), including :: and ::1
  if (groups.slice(0, 6).every((g) => g === 0)) {
    return groups[6] === 0 && groups[7] === 0
      ? true
      : isBlockedIPv4(embeddedIPv4());
  }

  const first = groups[0];
  if ((first & 0xfe00) === 0xfc00) {
    return true; // fc00::/7 unique local
  }
  if ((first & 0xffc0) === 0xfe80) {
    return true; // fe80::/10 link local
  }
  if ((first & 0xff00) === 0xff00) {
    return true; // ff00::/8 multicast
  }
  return false;
}

function expandIPv6(ip: string): number[] | null {
  const halves = ip.split("::");
  if (halves.length > 2) {
    return null;
  }

  const parse = (part: string): number[] | null => {
    if (part === "") {
      return [];
    }
    const groups: number[] = [];
    const pieces = part.split(":");
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      if (piece.includes(".")) {
        if (i !== pieces.length - 1 || !net.isIPv4(piece)) {
          return null;
        }
        const octets = piece.split(".").map((o) => parseInt(o, 10));
        groups.push((octets[0] << 8) | octets[1]);
        groups.push((octets[2] << 8) | octets[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(piece)) {
        return null;
      }
      groups.push(parseInt(piece, 16));
    }
    return groups;
  };

  const head = parse(halves[0]);
  if (!head) {
    return null;
  }
  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }
  const tail = parse(halves[1]);
  if (!tail) {
    return null;
  }
  const missing = 8 - head.length - tail.length;
  if (missing < 1) {
    return null;
  }
  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}
