import { beforeEach, describe, expect, it, vi } from "vitest";
import defaultCapability from "../../src-tauri/capabilities/default.json";
import {
  BUG_REPORT_URL,
  bugReportUrl,
  DISCORD_URL,
  EXTERNAL_LINKS,
  isAllowedLink,
  openExternalLink,
} from "./external-links";

const { ask, openUrl } = vi.hoisted(() => ({ ask: vi.fn(), openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

beforeEach(() => {
  ask.mockReset();
  openUrl.mockReset();
});

describe("opening an About link", () => {
  it("asks first, naming the exact address, and opens the browser only on Open", async () => {
    ask.mockResolvedValue(true);
    await expect(openExternalLink(EXTERNAL_LINKS.github)).resolves.toBe("opened");
    expect(ask).toHaveBeenCalledTimes(1);
    const [message, options] = ask.mock.calls[0];
    expect(message).toBe("This will open your web browser at:\nhttps://github.com/JoaquinArruiz");
    expect(options).toMatchObject({ okLabel: "Open", cancelLabel: "Cancel" });
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith("https://github.com/JoaquinArruiz");
  });

  it("opens nothing on Cancel", async () => {
    ask.mockResolvedValue(false);
    await expect(openExternalLink(EXTERNAL_LINKS.linkedin)).resolves.toBe("cancelled");
    expect(ask).toHaveBeenCalledTimes(1);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("asks before it opens, not after", async () => {
    const order: string[] = [];
    ask.mockImplementation(async () => {
      order.push("ask");
      return true;
    });
    openUrl.mockImplementation(async () => {
      order.push("open");
    });
    await openExternalLink(EXTERNAL_LINKS.linkedin);
    expect(order).toEqual(["ask", "open"]);
  });

  it("refuses any other address without even asking", async () => {
    for (const url of [
      "https://example.com",
      "https://github.com/JoaquinArruiz/other",
      "https://github.com/JoaquinArruiz/",
      "http://github.com/JoaquinArruiz",
      "https://www.linkedin.com/in/joaquinarruiz?x=1",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "",
    ]) {
      await expect(openExternalLink(url)).resolves.toBe("refused");
    }
    expect(ask).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("lets a failure of the browser reach the caller, after the question was answered", async () => {
    ask.mockResolvedValue(true);
    openUrl.mockRejectedValue(new Error("no browser"));
    await expect(openExternalLink(EXTERNAL_LINKS.github)).rejects.toThrow("no browser");
  });
});

describe("the permission to open web addresses", () => {
  const capability = defaultCapability as {
    permissions: (string | { identifier: string; allow?: { url: string }[] })[];
  };
  const openerEntries = capability.permissions.filter((p) =>
    (typeof p === "string" ? p : p.identifier).startsWith("opener:"),
  );

  it("allows opening an address, and only the About links and the bug report form", () => {
    expect(openerEntries).toHaveLength(1);
    const [entry] = openerEntries;
    expect(typeof entry).toBe("object");
    if (typeof entry === "string") return;
    expect(entry.identifier).toBe("opener:allow-open-url");
    // The form's address changes with the version and system, so its permission ends in a wildcard.
    const expected = [...Object.values(EXTERNAL_LINKS), `${BUG_REPORT_URL}&*`];
    if (DISCORD_URL) expected.push(DISCORD_URL);
    expect(entry.allow?.map((a) => a.url).sort()).toEqual(expected.sort());
  });

  it("lets the app read only the system's name, version and architecture", () => {
    const os = capability.permissions.filter((p) => typeof p === "string" && p.startsWith("os:"));
    expect(os.sort()).toEqual(["os:allow-arch", "os:allow-os-type", "os:allow-version"]);
  });

  it("does not use the plugin's default permission, which would allow any https address", () => {
    expect(capability.permissions).not.toContain("opener:default");
    expect(JSON.stringify(capability)).not.toContain("opener:allow-default-urls");
    expect(JSON.stringify(capability)).not.toContain("opener:allow-open-path");
  });
});

describe("the bug report address", () => {
  const fields = { version: "1.0.0", os: "Windows 11 (x86_64)" };

  it("is the issue form with the version and system in the address, which GitHub puts in the form", () => {
    const url = new URL(bugReportUrl(fields));
    expect(url.origin + url.pathname).toBe("https://github.com/JoaquinArruiz/Gutterberg/issues/new");
    expect(url.searchParams.get("template")).toBe("bug_report.yml");
    // The ids of the form's fields in .github/ISSUE_TEMPLATE/bug_report.yml.
    expect(url.searchParams.get("version")).toBe("1.0.0");
    expect(url.searchParams.get("os")).toBe("Windows 11 (x86_64)");
  });

  it("is opened after asking, with its exact address shown", async () => {
    ask.mockResolvedValue(true);
    const url = bugReportUrl(fields);
    await expect(openExternalLink(url)).resolves.toBe("opened");
    expect(ask.mock.calls[0][0]).toBe(`This will open your web browser at:\n${url}`);
    expect(openUrl).toHaveBeenCalledWith(url);
  });

  it("escapes what it carries, so it cannot change the address", () => {
    const url = bugReportUrl({ version: "1&template=other", os: "x#y" });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("template")).toBe("bug_report.yml");
    expect(parsed.searchParams.get("version")).toBe("1&template=other");
    expect(parsed.hash).toBe("");
    expect(isAllowedLink(url)).toBe(true);
  });

  it("is the only GitHub address allowed beyond the profile: nothing else is opened", async () => {
    for (const url of [
      "https://github.com/JoaquinArruiz/Gutterberg/issues/new",
      "https://github.com/JoaquinArruiz/Gutterberg/issues/new?template=feature_request.yml&version=1",
      "https://github.com/JoaquinArruiz/Gutterberg/issues/new?template=bug_report.yml",
      "https://github.com/JoaquinArruiz/Gutterberg/issues/new?template=bug_report.yml&version=1#x",
      "https://github.com/JoaquinArruiz/Gutterberg/issues",
      "https://github.com/JoaquinArruiz/Gutterberg",
      "https://evil.example/https://github.com/JoaquinArruiz/Gutterberg/issues/new?template=bug_report.yml&x=1",
      "http://github.com/JoaquinArruiz/Gutterberg/issues/new?template=bug_report.yml&version=1",
    ]) {
      expect(isAllowedLink(url)).toBe(false);
      await expect(openExternalLink(url)).resolves.toBe("refused");
    }
    expect(ask).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("has no Discord address yet", () => {
    expect(DISCORD_URL).toBeNull();
  });
});
