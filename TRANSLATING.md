# Translating Gutterberg

Thanks for wanting to bring Gutterberg to your language. Every translation is welcome. This page says how one gets in,
how it stays up to date, and who looks after it. For anything else about contributing, see
[CONTRIBUTING.md](CONTRIBUTING.md).

## What is translated

The app: every text you see in it, from the menus to the help tips and tutorials. That is about 1,300 texts in one
file, `src/locales/en.json`.

The README, the docs, the changelog, the release notes and the Microsoft Store listing stay in English and Spanish,
which I write and keep up to date myself.

## Who looks after a language

Each language has a **maintainer**: whoever brings it in, or takes it over later. The maintainer is asked when new
texts need translating (a few times a year, before a release) and reviews changes to their language. A language can
have more than one person, and when a maintainer has to stop, anyone can take over by saying so in the language's
issue.

English is mine and Spanish is mine too (neutral Latin American Spanish). I can't judge the wording of other
languages, so I check that a translation is complete and works, and the words are up to a native speaker.

## Translate a new language

1. **Say so first.** Open a [Translation issue](https://github.com/JoaquinArruiz/Gutterberg/issues/new?template=translation.yml)
   with your language, so two people don't translate the same one. If there is already an issue for it, join it.
2. **Set up** the app as in [CONTRIBUTING.md](CONTRIBUTING.md), so you can see your texts in place. Start a branch
   named `feature/translation-<code>` (for example `feature/translation-de`) from the version branch named there.
3. **Copy** `src/locales/en.json` to `src/locales/<code>.json`. Use the language's code (`de`, `fr`, `pt`, `pl`); add a
   region only when two variants really differ (`pt-BR`).
4. **Register it** in two places:
   - `src/lib/locale.ts`: add the code to `Language` and `LANGUAGES`, and the language's name in itself to
     `LANGUAGE_NAME` (`de: "Deutsch"`), so the picker is readable whatever language the app is in.
   - `src/i18n.ts`: import the file and add it to `resources`, as `en` and `es` are.
5. **Translate** the texts (the values, never the keys). The rules are below.
6. **Check** with `pnpm i18n:status <code>`: it says how many texts are translated, lists what is missing and what is
   wrong. Then run `pnpm test`, `pnpm lint` and `pnpm typecheck`, and open the app in your language (Preferences ›
   General › Language) to look for texts that are cut off or wrap badly. Long words are the usual problem.
7. **Open a pull request** against the version branch, titled "Add <language> translation". A new language goes in when
   it is complete. Add yourself under "Translations" in the README in the same pull request.

## Rules for the texts

- **Keep the `{{placeholders}}`** exactly as they are (`{{count}}`, `{{name}}`, ...): the app puts a value there. You can
  move them in the sentence, but not rename, drop or add one. The tests check this.
- **Plurals.** A text with `_one` and `_other` keys depends on a number. Your language has its own forms: Polish needs
  `_one`, `_few` and `_many`, Japanese only `_other`. `pnpm i18n:status` says which forms your language needs, and i18next
  picks the right one from the number.
- **Use the glossary.** The words the app uses for its own ideas (a **piece**, not a card; the **Source** and **Print**
  tabs; **source gap** and **output gap**; **bleed**; **cut marks**) are in the glossary in [AGENTS.md](AGENTS.md).
  Pick one word for each in your language and use it everywhere. Write your choices in your pull request, and in a
  table under "Glossaries" below, so the next translator uses them too.
- **Keep shortcuts and names as they are**: `Ctrl`, `Cmd`, `Shift`, file extensions (`.gtr`, `.pdf`), and names such as
  Gutterberg, PDF, GitHub and Discord.
- **Be natural, not literal.** A short, plain sentence that a player of board games would say is better than an exact
  copy of the English. Keep the tone friendly and direct, and talk to the user the way apps in your language usually do.
- **Units and numbers** are formatted by the app: don't change `mm`, `in` or `pt`. The decimal separator follows your
  language (a comma for German) unless the user picks one.

## Keep a language up to date

When I add or change a text in English, it goes into Spanish at once. Other languages may fall behind: a text a
language does not have yet shows in English, so the app never breaks, and `pnpm i18n:status` shows what is missing.

- **Before a release**, I open an issue listing the new and changed texts and mention each language's maintainer. A
  release does not wait for translations: what is translated by then goes in, the rest follows in the next one.
- **When an English text changes its meaning**, I give it a new key, so the old translation is no longer used and
  shows up as missing, rather than staying in the app and saying the wrong thing. A small wording fix keeps its key.
- **To update a language**, run `pnpm i18n:status <code>`, translate what it lists, and open a pull request titled
  "Update <language> translation".

## Review

A pull request for a language is reviewed by another native speaker when there is one: its maintainer, or someone from
the language's issue or from [Discord](https://discord.gg/ytBFE9TtRY). I check that it passes the tests, that it uses
its glossary, and that nothing is cut off on screen. When nobody else speaks the language, I merge it on the
translator's word, and anyone can improve it later.

## License and the CLA

A translation is a contribution like code: it is under the project's license, [PolyForm Noncommercial
1.0.0](LICENSE), and it needs the contributor license agreement, [CLA.md](CLA.md). You keep the copyright in your
translation and allow me to license it under any terms. When you open your first pull request, a bot asks you to sign
by posting one comment; you only do it once. Please translate yourself or with tools you are allowed to use this way,
and don't copy texts from other apps.

## Glossaries

Each language's words for the terms in the [AGENTS.md](AGENTS.md) glossary. Spanish is in AGENTS.md itself.

<!-- Add a section per language: "### Deutsch (de)" and a table of English term | your word. -->
