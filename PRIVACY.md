# Privacy policy

Gutterberg is a desktop app that works on your computer. This page says what it does with your data, for every
copy: the one from GitHub and the one from the Microsoft Store.

## What stays on your computer

Your PDFs, images, projects and settings stay on your computer. Gutterberg has no account, no analytics, no
tracking and no ads, and I collect nothing about you. The app keeps a short log of what it did on your computer;
it only leaves it if you copy it into a bug report yourself.

## What uses the network

Only two things, and neither sends anything about you or your files to me.

- **The update check** (only in the copy from GitHub). At most once a day the app asks GitHub for a small file,
  `latest.json`, that names the newest version, and downloads the new version when you say so. GitHub sees the
  request as it sees any visit to a web page ([GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)).
  With Preferences › Updates › Tell me about set to Never, the app does not check by itself. The Microsoft Store
  copy does not check: the Store updates it.
- **AI Mode**, which is off until you turn it on. It sends what an action needs to the AI provider you chose, with
  your own key: a picture of the page for Detect, small pictures of the pages for Sort pages, small pictures of the
  pieces for Pair backs. Each action shows what it sends and to which server, and waits for you to press Send,
  unless you ticked "Don't ask again" for that server. While AI Mode is on, choosing a provider asks it for its list
  of models, which carries your key and nothing else. With Ollama running on your own computer, nothing leaves it.
  AI Mode never sends a PDF whose publisher restricted it (against printing, changes, copying or anything else).

  What the provider does with what you send is up to its own terms and privacy policy. With a free (unpaid) key,
  some providers may use it to improve their products and have people review it; Google says so for the Gemini API's
  free tier. Their terms may also set an age limit (18 for the Gemini API).

## How it is kept safe

- AI requests use HTTPS. Plain http is allowed only to this computer or a private network address, so your
  key never crosses the internet unencrypted, and the app follows no redirects that could carry it elsewhere.
- Your key is kept in your system's keychain (on Windows, the Credential Manager), written and read only by the app's
  own code; it is never shown again, written to the log or sent anywhere but the provider you chose.
- Updates from GitHub are signed, and the app installs only an update whose signature matches.

## What is kept on your computer, and how to remove it

- Your settings, the log (about half a megabyte at most) and, while AI Mode is on, the provider's list of models
  (kept for a week). Uninstalling the Microsoft Store copy removes them; for the copy from GitHub they are in the
  `Gutterberg` folders in `%APPDATA%` and `%LOCALAPPDATA%` on Windows; in `~/Library/Application Support`,
  `~/Library/Caches` and `~/Library/Logs` on macOS; and in `~/.config`, `~/.local/share` and `~/.cache` on Linux.
- Your API key stays in the keychain until you remove it, even after uninstalling. Remove it first in
  Preferences › AI Mode, or later in the system's keychain (on Windows: Credential Manager › Windows Credentials,
  the entries ending in `gutterberg-ai`).
- To take back your consent at any time: untick "Don't ask again" (Preferences › AI Mode › Ask before sending),
  delete the key, or turn AI Mode off.

## Microsoft, GitHub and the links in the app

The Microsoft Store and Windows (including the WebView2 component the app draws its window with) follow Microsoft's
own privacy statement, not this one, and GitHub's statement covers the update check and downloads. The links in
Preferences (GitHub, Discord, LinkedIn) open in your browser, where those sites' own policies apply.

## Children

Gutterberg collects no personal data from anyone, children included.

## Changes and contact

If this changes, this page changes with it, and the [changelog](CHANGELOG.md) says so. Questions go to
[GitHub issues](https://github.com/JoaquinArruiz/Gutterberg/issues) or to joaquinarruiz@gmail.com.
