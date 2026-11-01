import { NotificationsEndpointNormalize } from "./NotificationsEndpoint";

describe("NotificationsEndpointNormalize", () => {
  it("should accept real push service URLs", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc123",
      "https://updates.push.services.mozilla.com/wpush/v2/abc123",
      "https://web.push.apple.com/QGabc123",
      "https://push.example.com/subscription?id=1",
    ]) {
      expect(NotificationsEndpointNormalize(endpoint)).toBe(endpoint);
    }
  });

  it("should trim surrounding whitespace and keep the original URL", () => {
    expect(
      NotificationsEndpointNormalize("  https://push.example.com/a?b=c  "),
    ).toBe("https://push.example.com/a?b=c");
  });

  it("should accept public IP literals", () => {
    expect(NotificationsEndpointNormalize("https://8.8.8.8/push")).toBe(
      "https://8.8.8.8/push",
    );
    expect(
      NotificationsEndpointNormalize("https://[2001:4860:4860::8888]/push"),
    ).toBe("https://[2001:4860:4860::8888]/push");
  });

  it("should reject non-string, empty and malformed values", () => {
    for (const endpoint of [
      undefined,
      null,
      42,
      {},
      [],
      "",
      "   ",
      "not a url",
      "https://",
      `https://push.example.com/${"a".repeat(2100)}`,
    ]) {
      expect(NotificationsEndpointNormalize(endpoint)).toBeNull();
    }
  });

  it("should reject non-HTTPS schemes", () => {
    for (const endpoint of [
      "http://push.example.com/sub",
      "ftp://push.example.com/sub",
      "javascript:alert(1)",
      "ws://push.example.com/sub",
    ]) {
      expect(NotificationsEndpointNormalize(endpoint)).toBeNull();
    }
  });

  it("should reject credentials in the URL", () => {
    expect(
      NotificationsEndpointNormalize("https://user:pass@push.example.com/a"),
    ).toBeNull();
    expect(
      NotificationsEndpointNormalize("https://user@push.example.com/a"),
    ).toBeNull();
  });

  it("should reject local and internal hostnames", () => {
    for (const endpoint of [
      "https://localhost/push",
      "https://LOCALHOST/push",
      "https://api.localhost/push",
      "https://printer.local/push",
      "https://metadata.internal/push",
    ]) {
      expect(NotificationsEndpointNormalize(endpoint)).toBeNull();
    }
  });

  it("should accept a public FQDN with a trailing dot", () => {
    const endpoint = "https://push.example.com./a";
    expect(NotificationsEndpointNormalize(endpoint)).toBe(endpoint);
  });

  it("should reject private and reserved IPv4 literals", () => {
    for (const ip of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "127.0.0.1",
      "127.1.2.3",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.1",
      "192.0.2.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.19.255.255",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      expect(NotificationsEndpointNormalize(`https://${ip}/push`)).toBeNull();
    }
  });

  it("should reject loopback, private and mapped IPv6 literals", () => {
    for (const ip of [
      "[::]",
      "[::1]",
      "[fc00::1]",
      "[fd12:3456::1]",
      "[fe80::1]",
      "[ff02::1]",
      "[::ffff:127.0.0.1]",
      "[::ffff:7f00:1]",
      "[::ffff:10.0.0.1]",
      "[::ffff:a00:1]",
    ]) {
      expect(NotificationsEndpointNormalize(`https://${ip}/push`)).toBeNull();
    }
  });

  it("should accept an IPv4-mapped public address", () => {
    expect(
      NotificationsEndpointNormalize("https://[::ffff:8.8.8.8]/push"),
    ).toBe("https://[::ffff:8.8.8.8]/push");
  });
});
