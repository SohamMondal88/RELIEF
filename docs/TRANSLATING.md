# Translating RELIEF

RELIEF has a small language layer with no build step. English is the default and Bengali (`bn`) is the first extra language.

Files:

- `assets/js/i18n.js` applies translations and adds the language selector to the navbar.
- `assets/locales/en.json` and `assets/locales/bn.json` hold the strings, one flat `"key": "text"` list each.
- `tests/i18n.test.js` checks that both files have the same keys and that the fallback works.

## Add a string to a page

1. Pick a key like `area.thing`, for example `login.forgot`.
2. Put the English text in `en.json` and the Bengali text in `bn.json`. The English value must match the text in the HTML.
3. Mark the element:

```html
<h1 data-i18n="firstaid.h1">First Aid Guide</h1>
<input placeholder="Enter your email" aria-label="Email"
       data-i18n-attr="placeholder:auth.email.placeholder;aria-label:auth.email">
```

`data-i18n` replaces the whole text of the element, so if the element also holds an icon or a link, wrap just the text in a `<span data-i18n="...">`. `data-i18n-attr` takes `attribute:key` pairs separated by `;`.

The page must load `assets/js/i18n.js` (add it before `app-enhancements.js`).

## Text built by JavaScript

Use `window.ReliefI18n.t('some.key', 'English fallback')`. After creating new elements with `data-i18n`, call `window.ReliefI18n.apply(element)`. The page also fires a `relief:languagechange` event on `document` when the language changes.

## Fallback

For each key the lookup order is the selected language, then English, then the text that was already in the HTML. A missing key never breaks a page.

## Add a language

1. Copy `en.json` to `assets/locales/<code>.json` and translate the values.
2. Add the code to `SUPPORTED` and an `<option>` in `buildSwitcher()` in `i18n.js`. If the script needs a web font, add it next to the Bengali font loading code.
3. Run `node --test tests/i18n.test.js`.

## Notes

- The selected language is saved in `localStorage` under `relief_lang`. If it is blocked or holds an unknown value, the browser language is used, then English.
- The locale files are loaded with `fetch`, so open the site through a local server (for example `python -m http.server`). Opening a page straight from disk keeps the English text.
- Medical content (for example the first aid guide steps) should only be translated by someone qualified to review it.
- Please ask a native speaker to review new translations before merging.
