import { describe, expect, it } from "vitest";
// @ts-expect-error a plain Node script with no types
import { buildPost } from "./discord-release-post.mjs";

const SECTIONS = [
  { name: "Added", items: ["Cut marks where the gaps cross.", "...and more!"] },
  { name: "Fixed", items: ["Test connection works with Gemini models."] },
];

describe("buildPost", () => {
  const post = (sections: unknown) =>
    buildPost({ tag: "v1.1.0", url: "https://example.com/v1.1.0", sections, roleId: "42" });

  it("pings the role, names the version, shows the summary and links the full changelog without an embed", () => {
    expect(post(SECTIONS)).toBe(
      [
        "<@&42>\n# Gutterberg 1.1.0 is out!",
        "## ✨ Added\n- Cut marks where the gaps cross.\n- ...and more!",
        "## 🛠️ Fixed\n- Test connection works with Gemini models.",
        "See the full changelog: <https://example.com/v1.1.0>",
      ].join("\n\n"),
    );
  });

  it("refuses a post over Discord's 2000 characters instead of cutting it", () => {
    expect(() => post([{ name: "Added", items: ["a long text ".repeat(200)] }])).toThrow(/over Discord's 2000/);
  });
});
