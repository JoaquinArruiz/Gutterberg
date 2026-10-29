#!/usr/bin/env node
// Posts a published GitHub release in the Discord server's #announcements channel, pinging the Release pings role,
// and publishes the post so servers that follow the channel get it too. Run by .github/workflows/discord-release.yml.
// The post is the version's summary from release-notes/, as checked out, so a release's summary comes from its tag.
// Env: TAG (v1.1.0), GITHUB_REPOSITORY, GITHUB_TOKEN, DISCORD_BOT_TOKEN, DISCORD_ANNOUNCEMENTS_CHANNEL_ID,
// DISCORD_RELEASE_ROLE_ID; DRY_RUN=true prints the post instead of sending it.
import { pathToFileURL } from "node:url";
import { readSummary } from "./release-summary.mjs";

// Discord refuses longer messages.
const LIMIT = 2000;

const EMOJI = { Added: "✨", Changed: "🔄", Deprecated: "⚠️", Removed: "🗑️", Fixed: "🛠️", Security: "🔒" };

// The post: the role ping, a heading, the version's summary (release-notes/<x.y.z>.md, see release-summary.mjs) and
// a link to the full notes on the release page. The summary is short by rule (the Store's 1500 characters), so the
// post is never cut; one that is too long anyway is refused rather than sent cut.
export function buildPost({ tag, url, sections, roleId }) {
  const version = tag.replace(/^v/, "");
  const post = [
    `${roleId ? `<@&${roleId}>\n` : ""}# Gutterberg ${version} is out!`,
    ...sections.map((s) =>
      `## ${EMOJI[s.name] ?? ""} ${s.name}\n${s.items.map((item) => `- ${item}`).join("\n")}`.trim(),
    ),
    `See the full changelog: <${url}>`,
  ].join("\n\n");
  if (post.length > LIMIT) throw new Error(`The post is ${post.length} characters, over Discord's ${LIMIT}.`);
  return post;
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
  const roleId = need("DISCORD_RELEASE_ROLE_ID");
  const sections = readSummary(tag.replace(/^v/, ""));
  const content = buildPost({ tag, url: release.html_url, sections, roleId });
  if (env.DRY_RUN === "true") {
    console.log(`Dry run, nothing sent. The post (${content.length} characters):\n\n${content}`);
    return;
  }
  const channel = need("DISCORD_ANNOUNCEMENTS_CHANNEL_ID");
  const headers = { Authorization: `Bot ${need("DISCORD_BOT_TOKEN")}`, "Content-Type": "application/json" };
  const api = "https://discord.com/api/v10";
  const message = await call(
    `${api}/channels/${channel}/messages`,
    { method: "POST", headers, body: JSON.stringify({ content, allowed_mentions: { parse: [], roles: [roleId] } }) },
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
