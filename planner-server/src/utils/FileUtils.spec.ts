import { buildContentDisposition } from "./FileUtils";

describe("buildContentDisposition", () => {
  it("should keep an ASCII name unchanged in both parameters", () => {
    expect(buildContentDisposition("attachment", "report.pdf")).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
    expect(buildContentDisposition("inline", "report.pdf")).toBe(
      `inline; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
  });

  it("should transliterate non-ASCII characters in the fallback and encode them in filename*", () => {
    expect(buildContentDisposition("attachment", "Résumé final.pdf")).toBe(
      `attachment; filename="R_sum_ final.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20final.pdf`,
    );
  });

  it("should fall back to underscores for CJK names", () => {
    expect(buildContentDisposition("attachment", "報告書.pdf")).toBe(
      `attachment; filename="___.pdf"; filename*=UTF-8''%E5%A0%B1%E5%91%8A%E6%9B%B8.pdf`,
    );
  });

  it("should neutralize quotes and backslashes in the fallback", () => {
    const result = buildContentDisposition("inline", 'a"b\\c.txt');
    expect(result).toBe(
      `inline; filename="a_b_c.txt"; filename*=UTF-8''a%22b%5Cc.txt`,
    );
    expect(result).not.toContain('\\"');
  });

  it("should not allow CR/LF header injection", () => {
    const result = buildContentDisposition(
      "attachment",
      "evil\r\nX-Injected: yes.txt",
    );
    expect(result).not.toContain("\r");
    expect(result).not.toContain("\n");
    expect(result).toBe(
      `attachment; filename="evil__X-Injected: yes.txt"; filename*=UTF-8''evil%0D%0AX-Injected%3A%20yes.txt`,
    );
  });

  it("should percent-encode the RFC 5987 reserved characters", () => {
    expect(buildContentDisposition("attachment", "a'b(c)d*e.txt")).toBe(
      `attachment; filename="a'b(c)d*e.txt"; filename*=UTF-8''a%27b%28c%29d%2Ae.txt`,
    );
  });
});
