// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type OpenDocument, useDocumentStore } from "../../stores/document-store";
import { useUiStore } from "../../stores/ui-store";
import { DocumentName } from "./DocumentName";
import { LockBadge } from "./LockBadge";

const A4 = { width_pt: 595, height_pt: 842 };
const doc = (id: number, name: string, access?: OpenDocument["access"]): OpenDocument => ({
  id,
  path: `/games/${name}.pdf`,
  pages: [A4],
  hash: String(id),
  ...(access ? { access } : {}),
});

afterEach(cleanup);

describe("the lock badge", () => {
  it("is not drawn for PDFs without restrictions", () => {
    render(<LockBadge documents={[doc(0, "free")]} />);
    expect(screen.queryByTestId("lock-badge")).toBeNull();
  });

  it("is red and says why for a PDF locked against printing", () => {
    render(<LockBadge documents={[doc(0, "game", { locked: "printing", restricted: false })]} />);
    const badge = screen.getByTestId("lock-badge");
    expect(badge.textContent).toBe("Locked");
    expect(badge.className).toContain("red");
    expect(badge.getAttribute("title")).toBe(
      "“game.pdf” doesn't allow printing, so it can't be exported. Contact its publisher for an unlocked print-and-play version.",
    );
  });

  it("names modifying when that is what is locked", () => {
    render(<LockBadge documents={[doc(0, "game", { locked: "modifying", restricted: false })]} />);
    expect(screen.getByTestId("lock-badge").getAttribute("title")).toContain("doesn't allow changes");
  });

  it("is amber for other restrictions, which the export keeps", () => {
    render(<LockBadge documents={[doc(0, "game", { locked: null, restricted: true })]} />);
    const badge = screen.getByTestId("lock-badge");
    expect(badge.textContent).toBe("Restricted");
    expect(badge.className).toContain("amber");
    expect(badge.getAttribute("title")).toContain("The exported PDF keeps them");
  });

  it("lists every PDF of the project that is affected, and is red if any is refused", () => {
    render(
      <LockBadge
        documents={[
          doc(0, "a", { locked: null, restricted: true }),
          doc(1, "b", { locked: "printing", restricted: false }),
          doc(2, "c"),
        ]}
      />,
    );
    const badge = screen.getByTestId("lock-badge");
    expect(badge.className).toContain("red");
    const title = badge.getAttribute("title") ?? "";
    expect(title).toContain("b.pdf");
    expect(title).toContain("a.pdf");
    expect(title).not.toContain("c.pdf");
  });
});

describe("the badge in the toolbar", () => {
  beforeEach(() => {
    useDocumentStore.getState().clear();
    useUiStore.setState({ stage: "cards" });
  });

  it("shows on the Source tab for the PDF being edited only", () => {
    useDocumentStore.getState().setDocuments([doc(0, "a"), doc(1, "b", { locked: "modifying", restricted: false })], 0);
    render(<DocumentName />);
    expect(screen.queryByTestId("lock-badge")).toBeNull();
    useDocumentStore.getState().setActive(1);
    cleanup();
    render(<DocumentName />);
    expect(screen.getByTestId("lock-badge")).toBeTruthy();
  });

  it("shows on the Print tab for any PDF of the project", () => {
    useDocumentStore.getState().setDocuments([doc(0, "a"), doc(1, "b", { locked: "modifying", restricted: false })], 0);
    useUiStore.setState({ stage: "print" });
    render(<DocumentName />);
    expect(screen.getByTestId("lock-badge")).toBeTruthy();
  });
});
