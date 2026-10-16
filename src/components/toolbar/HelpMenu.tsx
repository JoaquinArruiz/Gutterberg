import { CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUiStore } from "../../stores/ui-store";
import { menuItem, Popover } from "../workspace/Popover";

const shortcut = "ml-auto pl-4 text-[11px] text-[var(--muted)]";

/**
 * The `?` menu, next to Preferences with or without a PDF open: the Tutorials list, the keyboard shortcuts, the welcome
 * tour and how to report a problem, which are otherwise spread over File and Preferences.
 */
export function HelpMenu() {
  const { t } = useTranslation();
  const setTutorialsOpen = useUiStore((s) => s.setTutorialsOpen);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const setWelcomeOpen = useUiStore((s) => s.setWelcomeOpen);
  const setPrefsOpen = useUiStore((s) => s.setPrefsOpen);

  const item = (label: string, run: () => void, close: () => void, keys?: string) => (
    <button
      type="button"
      role="menuitem"
      className={menuItem}
      onClick={() => {
        close();
        run();
      }}
    >
      {label}
      {keys && <span className={shortcut}>{keys}</span>}
    </button>
  );

  return (
    <Popover
      label={t("helpMenu.label")}
      testId="help-menu"
      hintTarget="help-menu"
      triggerClassName="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-1 hover:bg-[var(--hover)]"
      trigger={<CircleHelp size={14} />}
    >
      {(close) => (
        <>
          {item(t("helpMenu.tutorials"), () => setTutorialsOpen(true), close)}
          {item(t("helpMenu.shortcuts"), () => setShortcutsOpen(true), close, "?")}
          {item(t("helpMenu.welcome"), () => setWelcomeOpen(true), close)}
          {/* The bug report is in Preferences › About: it opens there, on that field. */}
          {item(t("helpMenu.report"), () => setPrefsOpen(true, "About", "bugReport"), close)}
        </>
      )}
    </Popover>
  );
}
