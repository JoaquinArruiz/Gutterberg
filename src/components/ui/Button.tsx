import { Sparkles } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "default" | "primary" | "ghost" | "danger" | "ai";

const VARIANT: Record<ButtonVariant, string> = {
  default: "border border-[var(--border)] hover:bg-[var(--hover)]",
  primary: "bg-[var(--accent)] font-medium text-black hover:brightness-110",
  // Icon buttons: quiet until hovered.
  ghost: "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]",
  danger: "border border-red-400/60 text-red-300 hover:bg-red-400/10",
  // Actions that send something to an AI provider: a violet border and a spark (see `--ai`).
  ai: "inline-flex items-center justify-center gap-1.5 border border-[var(--ai)] hover:bg-[var(--ai-soft)]",
};

const SIZE: Record<"sm" | "md", Record<ButtonVariant, string>> = {
  sm: { default: "px-2 py-0.5", primary: "px-2.5 py-1", ghost: "p-1", danger: "px-2 py-0.5", ai: "px-2 py-0.5" },
  md: { default: "px-3 py-1", primary: "px-3 py-1", ghost: "p-1.5", danger: "px-3 py-1", ai: "px-3 py-1" },
};

/**
 * The app's one button. `ai` puts a spark in front of the text; with `iconOnly` the children are an icon and the
 * spark becomes a small badge in the corner instead. `busy` pulses the spark while a request runs (still, with
 * reduced motion).
 */
export function Button({
  variant = "default",
  size = "sm",
  iconOnly = false,
  busy = false,
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  /** `ai` only: the children are an icon, not text. */
  iconOnly?: boolean;
  /** `ai` only: a request is running. */
  busy?: boolean;
  /** To focus the button from outside (React 19 passes `ref` like any prop). */
  ref?: React.Ref<HTMLButtonElement>;
}) {
  const ai = variant === "ai";
  const spark = (
    <Sparkles
      size={12}
      aria-hidden="true"
      data-ai="spark"
      className={`shrink-0 text-[var(--ai)] ${busy ? "animate-pulse motion-reduce:animate-none" : ""}`}
    />
  );
  return (
    <button
      type={type}
      {...rest}
      className={`${ai && iconOnly ? "relative " : ""}rounded disabled:opacity-40 ${VARIANT[variant]} ${SIZE[size][variant]} ${className}`}
    >
      {ai && !iconOnly && spark}
      {children}
      {ai && iconOnly && (
        <span className="absolute -right-1 -top-1 flex rounded-full bg-[var(--panel)] p-px">{spark}</span>
      )}
    </button>
  );
}
