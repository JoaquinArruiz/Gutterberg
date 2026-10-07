import { useEffect, useState } from "react";
import { type RenderKind, renderPage } from "./tauri";

/**
 * Renders `pageIndex` at `widthPx`, returning a blob URL (or null while
 * loading). `docKey` invalidates when another PDF is opened. Debounced so a
 * panel drag doesn't fire a render per frame.
 */
export function usePageImage(
  docKey: string | null,
  pageIndex: number,
  widthPx: number,
  debounceMs = 0,
  kind: RenderKind = "page",
) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!docKey || widthPx <= 0) return;
    let cancelled = false;
    let created: string | null = null;
    const t = setTimeout(() => {
      renderPage(kind, pageIndex, widthPx)
        .then((u) => {
          if (cancelled) return URL.revokeObjectURL(u);
          created = u;
          setUrl(u);
        })
        .catch(() => {});
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
      // Revoke after the next image has replaced this one.
      if (created) setTimeout(() => URL.revokeObjectURL(created!), 1000);
    };
  }, [docKey, pageIndex, widthPx, debounceMs, kind]);

  return docKey ? url : null;
}
