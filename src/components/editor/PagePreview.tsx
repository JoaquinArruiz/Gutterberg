import { useDocumentStore } from "../../stores/document-store";
import { usePageImage } from "../../lib/use-page-image";

/** Raster preview of the current page, drawn at `widthCss` CSS pixels. */
export function PagePreview({ widthCss, heightCss }: { widthCss: number; heightCss: number }) {
  const { path, currentPage } = useDocumentStore();
  const dpr = window.devicePixelRatio || 1;
  const url = usePageImage(path, currentPage, Math.round(widthCss * dpr), 150);
  return (
    <div className="bg-white shadow-lg shadow-black/50" style={{ width: widthCss, height: heightCss }}>
      {url && <img src={url} draggable={false} style={{ width: "100%", height: "100%" }} />}
    </div>
  );
}
