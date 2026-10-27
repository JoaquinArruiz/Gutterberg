import { describe, expect, it } from "vitest";
import { filesElsewhere, projectFiles } from "./sharing";

describe("the files of a shared project", () => {
  it("are every PDF and every image the project reads", () => {
    const files = projectFiles([
      { kind: "pdf", path: "/games/a.pdf", hash: "1" },
      { kind: "images", name: "Tokens", images: [{ path: "/games/t1.png" }, { path: "/games/t2.png" }] },
    ] as Parameters<typeof projectFiles>[0]);
    expect(files).toEqual(["/games/a.pdf", "/games/t1.png", "/games/t2.png"]);
  });

  it("that are not in the project's folder are named, with either kind of separator", () => {
    expect(filesElsewhere("C:\\Games\\kit.gtr", ["C:\\Games\\a.pdf", "C:\\Downloads\\b.pdf"])).toEqual(["b.pdf"]);
    expect(filesElsewhere("/games/kit.gtr", ["/games/a.pdf", "/games/old/b.pdf"])).toEqual(["b.pdf"]);
  });
});
