/**
 * Relief i18n: small language layer with no build step.
 *
 * Markup:
 *   <h1 data-i18n="home.title">Original English text</h1>
 *   <input data-i18n-attr="placeholder:form.email;aria-label:form.email.aria">
 *
 * Lookup order for a key: selected language, then English, then the text that
 * was already in the HTML. Missing keys never break the page.
 * See docs/TRANSLATING.md.
 */
(function (root) {
    'use strict';

    var SUPPORTED = ['en', 'bn'];
    var DEFAULT_LANG = 'en';
    var STORAGE_KEY = 'relief_lang';
    var FONT_URL = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700&display=swap';

    var dictionaries = {};
    var currentLang = DEFAULT_LANG;

    // Where the locale files live, derived from this script's own URL.
    var localeBase = '';
    if (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) {
        localeBase = document.currentScript.src.replace(/js\/i18n\.js(\?.*)?$/, 'locales/');
    }

    function isSupported(lang) {
        return SUPPORTED.indexOf(lang) !== -1;
    }

    function pickLanguage(saved, browserLangs) {
        if (isSupported(saved)) return saved;
        var list = browserLangs || [];
        for (var i = 0; i < list.length; i++) {
            var code = String(list[i] || '').toLowerCase().split('-')[0];
            if (isSupported(code)) return code;
        }
        return DEFAULT_LANG;
    }

    // Pure lookup: selected language -> English -> fallback text -> null.
    function translate(dicts, lang, key, fallback) {
        var d = dicts && dicts[lang];
        if (d && typeof d[key] === 'string') return d[key];
        var en = dicts && dicts[DEFAULT_LANG];
        if (en && typeof en[key] === 'string') return en[key];
        return typeof fallback === 'string' ? fallback : null;
    }

    function t(key, fallback) {
        var value = translate(dictionaries, currentLang, key, fallback);
        return value === null ? key : value;
    }

    function readSaved() {
        try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }

    function writeSaved(lang) {
        try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* storage blocked */ }
    }

    function applyTo(scope) {
        if (typeof document === 'undefined') return;
        var rootEl = scope || document;

        rootEl.querySelectorAll('[data-i18n]').forEach(function (el) {
            var key = el.getAttribute('data-i18n');
            if (el.dataset.i18nOrig === undefined) el.dataset.i18nOrig = el.textContent;
            var value = translate(dictionaries, currentLang, key, el.dataset.i18nOrig);
            if (value !== null && el.textContent !== value) el.textContent = value;
        });

        rootEl.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
            var origs = el._i18nOrig || (el._i18nOrig = {});
            el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
                var idx = pair.indexOf(':');
                if (idx < 1) return;
                var attr = pair.slice(0, idx).trim();
                var key = pair.slice(idx + 1).trim();
                if (!(attr in origs)) origs[attr] = el.getAttribute(attr);
                var value = translate(dictionaries, currentLang, key, origs[attr]);
                if (value !== null) el.setAttribute(attr, value);
            });
        });
    }

    function loadDictionary(lang) {
        if (dictionaries[lang]) return Promise.resolve();
        if (typeof fetch !== 'function' || !localeBase) return Promise.resolve();
        return fetch(localeBase + lang + '.json')
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) { dictionaries[lang] = data; })
            .catch(function () { /* page keeps its original text */ });
    }

    function ensureBengaliFont() {
        if (document.getElementById('relief-bn-font')) return;
        var link = document.createElement('link');
        link.id = 'relief-bn-font';
        link.rel = 'stylesheet';
        link.href = FONT_URL;
        document.head.appendChild(link);
    }

    function injectStyles() {
        if (document.getElementById('relief-i18n-style')) return;
        var style = document.createElement('style');
        style.id = 'relief-i18n-style';
        style.textContent =
            'html[lang="bn"] body, html[lang="bn"] button, html[lang="bn"] input, html[lang="bn"] select, html[lang="bn"] textarea {' +
            ' font-family: "Noto Sans Bengali", "Poppins", "Open Sans", sans-serif; }' +
            'html[lang="bn"] body { line-height: 1.7; }' +
            'html[lang="bn"] .nav-links a, html[lang="bn"] .btn-primary, html[lang="bn"] .btn-secondary,' +
            ' html[lang="bn"] .btn-login, html[lang="bn"] .btn-signup { overflow-wrap: anywhere; }' +
            '.navbar-right { display: flex; align-items: center; }' +
            '.relief-lang-switch { display: inline-flex; align-items: center; margin: 0 8px; }' +
            '.relief-lang-switch select { padding: 6px 8px; border: 1px solid #b8c4d6; border-radius: 6px;' +
            ' background: #fff; color: #1f2d3d; font-size: 0.9rem; max-width: 110px; cursor: pointer; }' +
            '@media (max-width: 992px) { .navbar-right .relief-lang-switch { position: absolute; right: -54px; top: calc(100% + 6px); margin: 0; z-index: 1001; } }' +
            '.relief-lang-switch--floating { position: fixed; left: 16px; bottom: 16px; z-index: 9999;' +
            ' background: #fff; padding: 8px 10px; border-radius: 12px; box-shadow: 0 8px 16px rgba(0,0,0,.15); }';
        document.head.appendChild(style);
    }

    function buildSwitcher() {
        if (document.getElementById('relief-lang')) return;
        var wrap = document.createElement('div');
        wrap.className = 'relief-lang-switch';

        var select = document.createElement('select');
        select.id = 'relief-lang';
        select.setAttribute('aria-label', 'Language');
        select.setAttribute('data-i18n-attr', 'aria-label:lang.label');
        [['en', 'English'], ['bn', 'বাংলা']].forEach(function (pair) {
            var opt = document.createElement('option');
            opt.value = pair[0];
            opt.textContent = pair[1];
            opt.setAttribute('lang', pair[0]);
            select.appendChild(opt);
        });
        select.value = currentLang;
        select.addEventListener('change', function (e) { setLanguage(e.target.value); });
        wrap.appendChild(select);

        var navRight = document.querySelector('.navbar-right');
        if (navRight) {
            var burger = navRight.querySelector('.hamburger');
            // Outside the mobile drawer, so it stays reachable on small screens.
            navRight.insertBefore(wrap, burger || null);
        } else {
            wrap.classList.add('relief-lang-switch--floating');
            document.body.appendChild(wrap);
        }
    }

    function setLanguage(lang) {
        if (!isSupported(lang)) lang = DEFAULT_LANG;
        currentLang = lang;
        writeSaved(lang);
        document.documentElement.setAttribute('lang', lang);
        if (lang === 'bn') ensureBengaliFont();
        var select = document.getElementById('relief-lang');
        if (select) select.value = lang;
        return Promise.all([loadDictionary(DEFAULT_LANG), loadDictionary(lang)]).then(function () {
            applyTo(document);
            document.dispatchEvent(new CustomEvent('relief:languagechange', { detail: { lang: lang } }));
        });
    }

    function init() {
        injectStyles();
        var browserLangs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language];
        currentLang = pickLanguage(readSaved(), browserLangs);
        buildSwitcher();
        setLanguage(currentLang);
    }

    var api = {
        SUPPORTED: SUPPORTED,
        pickLanguage: pickLanguage,
        translate: translate,
        t: t,
        apply: applyTo,
        setLanguage: setLanguage,
        getLanguage: function () { return currentLang; }
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        window.ReliefI18n = api;
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
