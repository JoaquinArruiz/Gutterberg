import { beforeEach, describe, expect, it, vi } from "vitest";
import defaultCapability from "../../src-tauri/capabilities/default.json";
import { ABOUT_LINKS, openExternalLink } from "./external-links";

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
    await expect(openExternalLink(ABOUT_LINKS.github)).resolves.toBe("opened");
    expect(ask).toHaveBeenCalledTimes(1);
    const [message, options] = ask.mock.calls[0];
    expect(message).toBe("This will open your web browser at:\nhttps://github.com/JoaquinArruiz");
    expect(options).toMatchObject({ okLabel: "Open", cancelLabel: "Cancel" });
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith("https://github.com/JoaquinArruiz");
  });

  it("opens nothing on Cancel", async () => {
    ask.mockResolvedValue(false);
    await expect(openExternalLink(ABOUT_LINKS.linkedin)).resolves.toBe("cancelled");
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
    await openExternalLink(ABOUT_LINKS.linkedin);
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
    await expect(openExternalLink(ABOUT_LINKS.github)).rejects.toThrow("no browser");
  });
});

describe("the permission to open web addresses", () => {
  const capability = defaultCapability as {
    permissions: (string | { identifier: string; allow?: { url: string }[] })[];
  };
  const openerEntries = capability.permissions.filter((p) =>
    (typeof p === "string" ? p : p.identifier).startsWith("opener:"),
  );

  it("allows opening an address, and only the two About links", () => {
    expect(openerEntries).toHaveLength(1);
    const [entry] = openerEntries;
    expect(typeof entry).toBe("object");
    if (typeof entry === "string") return;
    expect(entry.identifier).toBe("opener:allow-open-url");
    expect(entry.allow?.map((a) => a.url).sort()).toEqual(Object.values(ABOUT_LINKS).sort());
  });

  it("does not use the plugin's default permission, which would allow any https address", () => {
    expect(capability.permissions).not.toContain("opener:default");
    expect(JSON.stringify(capability)).not.toContain("opener:allow-default-urls");
    expect(JSON.stringify(capability)).not.toContain("opener:allow-open-path");
  });
});
