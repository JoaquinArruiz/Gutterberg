import { useDocumentStore } from "../stores/document-store";
import { useEditorStore } from "../stores/editor-store";

const STEP = 1.25;

/** Zoom/fit commands for the current page, centred on the viewport element. */
function run(fn: (page: NonNullable<ReturnType<typeof currentPage>>, box: { width: number; height: number }) => void) {
  const page = currentPage();
  const el = document.querySelector<HTMLElement>("[data-viewport]");
  if (page && el) fn(page, { width: el.clientWidth, height: el.clientHeight });
}

const currentPage = () => {
  const s = useDocumentStore.getState();
  return s.pages[s.currentPage];
};

export const zoomActions = {
  zoomIn: () => run((p, b) => useEditorStore.getState().zoomBy(STEP, { x: b.width / 2, y: b.height / 2 }, p)),
  zoomOut: () => run((p, b) => useEditorStore.getState().zoomBy(1 / STEP, { x: b.width / 2, y: b.height / 2 }, p)),
  fitPage: () => run((p, b) => useEditorStore.getState().fit(b, p)),
};
