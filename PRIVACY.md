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
  The Microsoft Store copy does not check: the Store updates it.
- **AI Mode**, which is off until you turn it on. It sends what an action needs to the AI provider you chose, with
  your own key: a picture of the page for Detect, small pictures of the pages for Sort pages, small pictures of the
  pieces for Pair backs. Each action shows what it sends and to which server, and waits for you to press Send,
  unless you ticked "Don't ask again" for that server. While AI Mode is on, choosing a provider asks it for its list
  of models, which carries your key and nothing else. What the provider does with that data is up to its own
  privacy policy. Your key is kept in your system's keychain (on Windows, the Credential Manager). With Ollama
  running on your own computer, nothing leaves it.

## Children

Gutterberg collects no personal data from anyone, children included.

## Changes and contact

If this changes, this page changes with it, and the [changelog](CHANGELOG.md) says so. Questions go to
[GitHub issues](https://github.com/JoaquinArruiz/Gutterberg/issues) or to joaquinarruiz@gmail.com.
