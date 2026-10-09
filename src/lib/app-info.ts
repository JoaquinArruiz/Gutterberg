import { getName } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";

/** The product name, from the app's own configuration (null until known, and outside the app window). */
export function useAppName(): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getName()
      .then((n) => live && setName(n))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return name;
}
