#!/usr/bin/env node
// Posts a published GitHub release in the Discord server's #announcements channel, pinging the roles of the members
// who asked for that kind of update, and publishes the post so servers that follow the channel get it too. Run by
// .github/workflows/discord-release.yml.
// Env: TAG (v1.1.0), GITHUB_REPOSITORY, GITHUB_TOKEN, DISCORD_BOT_TOKEN, DISCORD_ANNOUNCEMENTS_CHANNEL_ID,
// DISCORD_RELEASE_ROLE_ID (every update), DISCORD_FEATURE_ROLE_ID and DISCORD_FIX_ROLE_ID (only features, only
// fixes; optional); DRY_RUN=true prints the post instead of sending it.
import { pathToFileURL } from "node:url";

// Discord refuses longer messages.
const LIMIT = 2000;

const SECTIONS = { Added: "✨ New", Changed: "🔄 Changed", Fixed: "🛠️ Fixed" };

// Each kind of update has its own heading and opening line. Changed counts as a feature.
const KINDS = {
  both: { head: (v) => `# 🎉 Gutterberg ${v} is out!`, intro: "New features and fixes:" },
  features: { head: (v) => `# ✨ Gutterberg ${v}: new features`, intro: "Here is what you can do now:" },
  fixes: {
    head: (v) => `# 🛠️ Gutterberg ${v}: fixes`,
    intro: "This version fixes bugs and adds nothing new. Updating is recommended.",
  },
};

// The `### Added`, `### Changed` and `### Fixed` lists of a release's notes (CHANGELOG.md's section), as
// { heading, items } in the order they appear. The paragraph before them and any other heading are left out.
export function parseNotes(body) {
  const sections = [];
  let current = null;
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      current = SECTIONS[heading[1]] ? { heading: SECTIONS[heading[1]], items: [] } : null;
      if (current) sections.push(current);
    } else if (current && /^\s*[-*]\s+/.test(line)) {
      current.items.push(line.replace(/^\s*[-*]\s+/, "").trim());
    } else if (current?.items.length && /^\s+\S/.test(line)) {
      // A bullet that goes on over several lines.
      current.items[current.items.length - 1] += ` ${line.trim()}`;
    }
  }
  return sections.filter((s) => s.items.length);
}

// What a release brings: "features", "fixes" or "both" (also when the notes have no lists at all).
export function releaseKind(sections) {
  const fixes = sections.some((s) => s.heading === SECTIONS.Fixed);
  const features = sections.some((s) => s.heading !== SECTIONS.Fixed);
  return features && !fixes ? "features" : fixes && !features ? "fixes" : "both";
}

// The roles a release pings: every-update always, plus the features or fixes role when the release has those.
// Roles that aren't set are left out.
export function rolesFor(kind, roles) {
  const ids = [roles.all];
  if (kind !== "fixes") ids.push(roles.features);
  if (kind !== "features") ids.push(roles.fixes);
  return ids.filter(Boolean);
}

// Cuts text to at most `max` characters, on a word, with an ellipsis.
function cut(text, max) {
  if (text.length <= max) return text;
  const short = text.slice(0, max - 1);
  const space = short.lastIndexOf(" ");
  return `${(space > max / 2 ? short.slice(0, space) : short).replace(/[\s,;:.]+$/, "")}…`;
}

// The changelog's bullets are written for the release page and run long. A bullet that opens with a name and a
// colon ("Cut marks on back sheets: with Backs…") keeps the name in bold and the first sentence after it; any
// other keeps its first sentence. Either way it is cut to `max` characters.
export function summarize(item, max = 160) {
  const firstSentence = (text) => text.match(/^.*?[.!?](?=\s+[A-Z`(]|$)/)?.[0] ?? text;
  const colon = item.indexOf(": ");
  if (colon > 0 && colon <= 60 && !item.slice(0, colon).includes("`")) {
    const name = item.slice(0, colon).replace(/\.$/, "");
    return `**${name}:** ${cut(firstSentence(item.slice(colon + 2)), Math.max(40, max - name.length))}`;
  }
  return cut(firstSentence(item), max);
}

// The post: the role pings inside a spoiler (they still notify, but don't clutter the post), a heading and an
// opening line for the kind of update, a section per list and a link to the release. When it doesn't fit in
// Discord's limit, the bullets get shorter, then the last ones of each list are left for the release page.
export function buildPost({ tag, url, body, roles = {} }) {
  const version = tag.replace(/^v/, "");
  const sections = parseNotes(body);
  const kind = releaseKind(sections);
  const pings = rolesFor(kind, roles).map((id) => `<@&${id}>`);
  const head = `${pings.length ? `||${pings.join(" ")}||\n` : ""}${KINDS[kind].head(version)}\n${KINDS[kind].intro}`;
  const foot = `The app offers the update on its own, or [download it from GitHub](<${url}>).`;
  const render = (max, keep) =>
    [
      head,
      ...sections.map((s) => {
        const shown = s.items.slice(0, keep).map((item) => `- ${summarize(item, max)}`);
        const more = s.items.length - shown.length;
        if (more > 0) shown.push(`- …and ${more} more in the release notes.`);
        return `## ${s.heading}\n${shown.join("\n")}`;
      }),
      foot,
    ].join("\n\n");
  for (const max of [160, 120, 90]) {
    const post = render(max, Infinity);
    if (post.length <= LIMIT) return post;
  }
  const most = Math.max(0, ...sections.map((s) => s.items.length));
  for (let keep = most - 1; keep >= 1; keep--) {
    const post = render(90, keep);
    if (post.length <= LIMIT) return post;
  }
  return render(90, 0).slice(0, LIMIT);
}

async function call(url, init, what) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function main(env) {
  const need = (name) => {
    if (!env[name]) throw new Error(`${name} is not set (repo Settings › Secrets and variables › Actions).`);
    return env[name];
  };
  const tag = need("TAG");
  const repo = need("GITHUB_REPOSITORY");
  const release = await call(
    `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    { headers: { Authorization: `Bearer ${need("GITHUB_TOKEN")}`, Accept: "application/vnd.github+json" } },
    `Reading the release ${tag}`,
  );
  const roles = {
    all: need("DISCORD_RELEASE_ROLE_ID"),
    features: env.DISCORD_FEATURE_ROLE_ID,
    fixes: env.DISCORD_FIX_ROLE_ID,
  };
  const body = release.body ?? "";
  const content = buildPost({ tag, url: release.html_url, body, roles });
  const pinged = rolesFor(releaseKind(parseNotes(body)), roles);
  if (env.DRY_RUN === "true") {
    console.log(`Dry run, nothing sent. The post (${content.length} characters):\n\n${content}`);
    return;
  }
  const channel = need("DISCORD_ANNOUNCEMENTS_CHANNEL_ID");
  const headers = { Authorization: `Bot ${need("DISCORD_BOT_TOKEN")}`, "Content-Type": "application/json" };
  const api = "https://discord.com/api/v10";
  const message = await call(
    `${api}/channels/${channel}/messages`,
    { method: "POST", headers, body: JSON.stringify({ content, allowed_mentions: { parse: [], roles: pinged } }) },
    "Posting in #announcements",
  );
  console.log(`Posted message ${message.id} in #announcements.`);
  // Publishing is a separate call; when it fails the post is already there, so it is not sent again.
  await call(
    `${api}/channels/${channel}/messages/${message.id}/crosspost`,
    { method: "POST", headers },
    `Publishing message ${message.id} to following servers (the post itself went out; publish it by hand)`,
  );
  console.log("Published it to the servers that follow #announcements.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.env).catch((err) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  });
}
