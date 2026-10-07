// Errors as the UI handles them. The Rust side sends `{ code, message, ...values }` (see
// `card_core::ErrorInfo`); the UI words them from the `errors.*` keys of the active language. A code
// with no translation falls back to the English `message`, so an error is never blank.

import { t } from "../i18n";
import { formatDecimal } from "./measurement";

export type ErrorValue = string | number;

export type AppError = {
  /** Stable name of what went wrong; null for a plain message (a string, a JS error). */
  code: string | null;
  /** English text: the fallback and what logs show. */
  message: string;
  values: Record<string, ErrorValue>;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Anything a rejected call can carry -> an `AppError`. */
export function toAppError(e: unknown): AppError {
  if (isRecord(e) && typeof e.message === "string") {
    const { code, message, ...rest } = e;
    const values: Record<string, ErrorValue> = {};
    for (const [k, v] of Object.entries(rest)) if (typeof v === "string" || typeof v === "number") values[k] = v;
    return { code: typeof code === "string" && code ? code : null, message: e.message, values };
  }
  return { code: null, message: String(e), values: {} };
}

/** Like `toAppError`, keeping null (no error) as it is. */
export const toAppErrorOrNull = (e: unknown): AppError | null => (e === null || e === undefined ? null : toAppError(e));

/** An error made by the UI itself, with a code the catalog knows. */
export const appError = (code: string, message: string, values: Record<string, ErrorValue> = {}): AppError => ({
  code,
  message,
  values,
});

/** True when the backend dropped this request because a newer one replaced it. */
export const isSupersededError = (e: unknown) => toAppError(e).code === "superseded" || String(e) === "superseded";

/** The error in the current language. `at_page` (set when an export stops at one page) puts the page first. */
export function formatError(error: AppError): string {
  const { code, message, values } = error;
  if (!code) return message;
  const shown: Record<string, ErrorValue> = {};
  // Sizes are millimetres; show them with the user's decimal separator.
  for (const [k, v] of Object.entries(values))
    shown[k] = k.endsWith("_mm") && typeof v === "number" ? formatDecimal(v, 1) : v;
  const key = `errors.${code}`;
  // biome-ignore lint/suspicious/noExplicitAny: the key comes from the backend, so it cannot be a typed key
  const text = (t as any)(key, { ...shown, defaultValue: message }) as string;
  const at = values.at_page;
  return at === undefined ? text : t("errors.at_page", { page: at, error: text });
}
