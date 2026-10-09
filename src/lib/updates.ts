// Updates (M15): the preferences that belong to them and the rules that need no app to be tested: which
// version is newer, whether the user wants to hear about it, what to say after an update, and how the release
// notes are read. Talking to the updater plugin is in `update-actions.ts`.

/** What "Tell me about" can be set to. It only decides the toast; Preferences › Updates always shows a newer version. */
export const UPDATE_NOTIFY = ["all", "features", "major", "never"] as const;
export type UpdateNotify = (typeof UPDATE_NOTIFY)[number];

/** The update being installed, kept until the next start so the app can tell whether it worked. */
export type PendingUpdate = { version: string; notes: string };

export interface UpdatePrefs {
  notify: UpdateNotify;
  /** When the app last asked for a newer version, in milliseconds since 1970 (0 = never). */
  lastCheck: number;
  /** A version the user said "Skip this version" to: no toast until a newer one. Empty = none. */
  skippedVersion: string;
  pending: PendingUpdate | null;
  /** The version that ran last time; empty on a first install, which shows no toast. */
  lastRunVersion: string;
}

export const DEFAULT_UPDATES: UpdatePrefs = {
  notify: "all",
  lastCheck: 0,
  skippedVersion: "",
  pending: null,
  lastRunVersion: "",
};

/** The automatic check runs at most this often. */
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
/** The automatic check waits this long after the app starts. */
export const CHECK_DELAY_MS = 10_000;

const MAX_VERSION = 64;
const MAX_NOTES = 20_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const version = (v: unknown) => (typeof v === "string" && v.length <= MAX_VERSION ? v : "");

/** Raw (possibly stale or corrupt) data -> valid update preferences. */
export function normalizeUpdates(raw: unknown): UpdatePrefs {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_UPDATES;
  const p = isObj(r.pending) ? r.pending : null;
  const pending = p && version(p.version) && typeof p.notes === "string" ? p : null;
  return {
    notify: UPDATE_NOTIFY.includes(r.notify as UpdateNotify) ? (r.notify as UpdateNotify) : d.notify,
    lastCheck: typeof r.lastCheck === "number" && Number.isFinite(r.lastCheck) && r.lastCheck > 0 ? r.lastCheck : 0,
    skippedVersion: version(r.skippedVersion),
    pending: pending ? { version: version(pending.version), notes: String(pending.notes).slice(0, MAX_NOTES) } : null,
    lastRunVersion: version(r.lastRunVersion),
  };
}

type Parsed = { core: [number, number, number]; pre: string[] };

/** `1.2.3` or `1.2.3-beta.1` (a leading `v` is ignored); anything else is not a version. */
export function parseVersion(text: string): Parsed | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
}

/** Semantic Versioning order: -1 when `a` is older than `b`, 1 when newer, 0 when equal (or not versions). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  // A pre-release comes before its release; two pre-releases compare identifier by identifier.
  if (x.pre.length === 0 || y.pre.length === 0) return x.pre.length === y.pre.length ? 0 : x.pre.length === 0 ? 1 : -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const numeric = /^\d+$/.test(p) && /^\d+$/.test(q);
    if (numeric) return Number(p) < Number(q) ? -1 : 1;
    if (/^\d+$/.test(p) !== /^\d+$/.test(q)) return /^\d+$/.test(p) ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

export type ChangeKind = "major" | "feature" | "patch";

/**
 * How big the step from `current` to `next` is, by the project's rule: PATCH fixes bugs, MINOR adds features,
 * MAJOR is big or breaking. Before 1.0 the same rule applies (0.9.0 → 0.10.0 is a feature, → 1.0.0 is major).
 */
export function changeKind(current: string, next: string): ChangeKind {
  const a = parseVersion(current);
  const b = parseVersion(next);
  if (!a || !b) return "feature";
  if (a.core[0] !== b.core[0]) return "major";
  if (a.core[1] !== b.core[1]) return "feature";
  return "patch";
}

/** Whether the "update available" toast should show for `available`, given "Tell me about" and the skipped version. */
export function shouldNotify(current: string, available: string, prefs: UpdatePrefs): boolean {
  if (prefs.notify === "never") return false;
  if (compareVersions(available, current) <= 0) return false;
  if (prefs.skippedVersion && compareVersions(available, prefs.skippedVersion) <= 0) return false;
  const kind = changeKind(current, available);
  if (prefs.notify === "major") return kind === "major";
  if (prefs.notify === "features") return kind !== "patch";
  return true;
}

export type AfterUpdate =
  /** The version that was being installed is the one running: say so, with its notes. */
  | { kind: "updated"; version: string; notes: string }
  /** The app is older than the version that was being installed: it did not finish. */
  | { kind: "failed"; version: string }
  /** First install, a normal start, or a stale record. */
  | { kind: "none" };

/** What to tell the user at start, from the running version and the record left before installing. */
export function afterUpdate(current: string, prefs: UpdatePrefs): AfterUpdate {
  const { pending } = prefs;
  if (!pending) return { kind: "none" };
  const order = compareVersions(current, pending.version);
  if (order === 0) return { kind: "updated", version: pending.version, notes: pending.notes };
  if (order < 0) return { kind: "failed", version: pending.version };
  return { kind: "none" };
}

/** A piece of release notes. Always text: nothing here is ever HTML. */
export type NoteBlock = { type: "heading" | "paragraph"; text: string } | { type: "bullets"; items: string[] };

/**
 * Release notes (Markdown, as in CHANGELOG.md) as plain blocks: `###` headings, `-` or `*` bullets and paragraphs.
 * Emphasis marks and code ticks are left as typed; links and tags are text like any other.
 */
export function parseNotes(notes: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const raw of notes.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (heading) {
      flush();
      blocks.push({ type: "heading", text: heading[1] });
    } else if (bullet) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.type === "bullets") last.items.push(bullet[1]);
      else blocks.push({ type: "bullets", items: [bullet[1]] });
    } else paragraph.push(line);
  }
  flush();
  return blocks;
}
