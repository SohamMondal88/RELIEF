#!/usr/bin/env node
/**
 * Keeps the header and footer of every public page in sync (Issue #104).
 *
 * The site is plain HTML with no build step, so each page carries its own copy of the header and footer.
 * The copies are written from the templates in layout/ by this script, and a unit test fails when a page
 * has drifted from them. The pages stay plain HTML that works without JavaScript.
 *
 *   node scripts/shared-layout.js           rewrite the shared parts of every page
 *   node scripts/shared-layout.js --check   change nothing, exit 1 and list the pages that are out of date
 *
 * A shared part sits between two comment lines:
 *   <!-- shared-layout:header begin site ... -->  ...  <!-- shared-layout:header end -->
 * Do not edit between them by hand. Edit layout/*.tpl and run the script. A page with no markers yet has its
 * old header or footer replaced the first time the script runs.
 *
 * Template tokens:
 *   {{root}}                 the way back to the site root from this page ("" or "../")
 *   {{if:tour}} ... {{endif}} kept only on pages that have the first-visit tour (home page)
 * The link to the page being shown gets aria-current="page".
 *
 * See docs/SHARED_LAYOUT.md.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LAYOUT_DIR = path.join(ROOT, 'layout');

// Pages that use the full site header (logo, menu, Login) and footer. Their own stylesheet draws it.
const SITE_PAGES = [
  'index.html',
  'pages/about.html',
  'pages/ambulances.html',
  'pages/appointments.html',
  'pages/blog.html',
  'pages/contact.html',
  'pages/doctors.html',
  'pages/firstaid.html',
  'pages/hospitals.html',
  'pages/login.html',
  'pages/pharmacies.html',
  'pages/signup.html',
  'pages/symptoms.html'
];

// Pages built on professional-pages.css: a one-line top bar and a small footer.
const COMPACT_PAGES = [
  'pages/admin-panel.html',
  'pages/careers.html',
  'pages/dashboard.html',
  'pages/donate.html',
  'pages/health-events.html',
  'pages/how-it-works.html',
  'pages/press.html',
  'pages/privacy.html',
  'pages/subscription.html',
  'pages/team.html',
  'pages/volunteer.html'
];

// Pages that deliberately keep their own markup, and why. The unit test checks that each still has a way to the
// emergency page, and that nothing else in the repository carries a copy of the shared header or footer.
const EXEMPT_PAGES = {
  '404.html': 'Self-contained and JavaScript free, because it is served from any URL depth. It uses root-absolute paths.',
  'pages/offline.html': 'The offline fallback must work with nothing else saved. It shows the emergency numbers itself.',
  'pages/home.html': 'A redirect stub to the home page, with no content of its own.',
  'pages/accessibility.html': 'The accessibility statement has its own small header and footer with links back to the site.',
  'pages/cookie-policy.html': 'Legal text with inline styles and no site chrome.',
  'pages/privacy-policy.html': 'Legal text with inline styles and no site chrome.',
  'pages/terms-of-service.html': 'Legal text with inline styles and no site chrome.'
};

const PARTS = ['header', 'footer', 'head'];

function pageInfo(file) {
  const variant = SITE_PAGES.includes(file) ? 'site' : COMPACT_PAGES.includes(file) ? 'compact' : null;
  if (!variant) return null;
  return {
    file,
    variant,
    root: file.includes('/') ? '../' : '',
    features: file === 'index.html' ? ['tour'] : []
  };
}

function readTemplate(name) {
  return fs.readFileSync(path.join(LAYOUT_DIR, name + '.tpl'), 'utf8').replace(/\s+$/, '');
}

function templateName(part, variant) {
  return part === 'head' ? 'head' : variant + '-' + part;
}

/** Marks the link that points at the page being shown. */
function markCurrent(html, page) {
  const self = page.root + page.file;
  return html.replace(/<a\s([^>]*)>/g, (tag, attrs) => {
    const href = (attrs.match(/(?:^|\s)href="([^"]*)"/) || [])[1];
    if (href !== self || /\baria-current=/.test(attrs)) return tag;
    return '<a aria-current="page" ' + attrs + '>';
  });
}

/** The text of one shared part for one page, without markers. */
function render(part, page) {
  const name = templateName(part, page.variant);
  const text = readTemplate(name)
    .replace(/\{\{if:(\w+)\}\}\n?([\s\S]*?)\{\{endif\}\}\n?/g, (all, feature, body) => (page.features.includes(feature) ? body : ''))
    .replace(/\{\{root\}\}/g, page.root);
  return markCurrent(text, page).replace(/\n+$/, '');
}

function beginMarker(part, page) {
  const name = templateName(part, page.variant);
  return '<!-- shared-layout:' + part + ' begin ' + page.variant + ' | generated from layout/' + name + '.tpl, edit that file and run: node scripts/shared-layout.js -->';
}

function endMarker(part) {
  return '<!-- shared-layout:' + part + ' end -->';
}

function block(part, page) {
  return beginMarker(part, page) + '\n' + render(part, page) + '\n' + endMarker(part);
}

function markerPattern(part) {
  return new RegExp('([ \\t]*)<!-- shared-layout:' + part + ' begin [^>]*-->[\\s\\S]*?<!-- shared-layout:' + part + ' end -->');
}

/** Puts the same indentation in front of every line, so a part keeps the indentation it had in the page. */
function indentLines(text, indent) {
  return indent ? text.split('\n').map((line) => (line ? indent + line : line)).join('\n') : text;
}

/** Replaces the text matched by `regex` with `text`, keeping the indentation the old text had. */
function replaceFirst(html, regex, text) {
  const match = regex.exec(html);
  if (!match) return null;
  let start = match.index;
  const lineStart = html.lastIndexOf('\n', start - 1) + 1;
  const indented = /^[ \t]*$/.test(html.slice(lineStart, start));
  const indent = indented ? html.slice(lineStart, start) : '';
  if (indented) start = lineStart;
  const end = match.index + match[0].length;
  const lead = indented ? '' : '\n';
  const trail = html.slice(end, end + 1) === '\n' || end >= html.length ? '' : '\n';
  return html.slice(0, start) + lead + indentLines(text, indent) + trail + html.slice(end);
}

// What an old, unmarked page has in place of each part. Used once per page, when it joins the shared layout.
const OLD_MARKUP = {
  site: {
    header: /<nav\s+class="navbar"[\s\S]*?<\/nav>/,
    footer: /<footer\b[\s\S]*?<\/footer>/
  },
  compact: {
    header: /(?:<a\s+href="#main-content"\s+class="skip-link"[^>]*>[^<]*<\/a>\s*)?<header\s+class="topbar"[\s\S]*?<\/header>/,
    footer: /<footer\b[\s\S]*?<\/footer>/
  }
};

function adopt(html, part, page, text) {
  if (part === 'head') {
    const at = html.indexOf('</head>');
    if (at === -1) throw new Error(page.file + ': no </head> to add the shared stylesheet to');
    return html.slice(0, at) + text + '\n' + html.slice(at);
  }
  const old = OLD_MARKUP[page.variant][part];
  const replaced = replaceFirst(html, old, text);
  if (replaced !== null) return replaced;
  // A page with no header or footer of its own: put it before <main>, or after </main>.
  const anchor = part === 'header' ? /<main\b/ : /<\/main>/;
  const found = anchor.exec(html);
  if (!found) throw new Error(page.file + ': cannot find where the ' + part + ' goes');
  const at = part === 'header' ? found.index : found.index + found[0].length;
  return html.slice(0, at) + (part === 'header' ? '' : '\n') + text + '\n' + html.slice(at);
}

/** The page as it should be. Pure: same input, same output. */
function apply(html, page) {
  let out = html;
  PARTS.forEach((part) => {
    const text = block(part, page);
    const pattern = markerPattern(part);
    out = pattern.test(out)
      ? out.replace(pattern, (all, indent) => indentLines(text, indent))
      : adopt(out, part, page, text);
  });
  return out;
}

function managedPages() {
  return SITE_PAGES.concat(COMPACT_PAGES);
}

/** Returns the pages whose shared parts differ from the templates, with what the file should contain. */
function findDrift(read) {
  const readFile = read || ((file) => fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const drift = [];
  managedPages().forEach((file) => {
    const html = readFile(file);
    const expected = apply(html, pageInfo(file));
    if (expected !== html) drift.push({ file, expected });
  });
  return drift;
}

function main(argv) {
  const check = argv.includes('--check');
  const drift = findDrift();
  if (check) {
    if (drift.length === 0) {
      console.log('Shared header and footer are in sync on ' + managedPages().length + ' pages.');
      return 0;
    }
    console.error('These pages differ from layout/*.tpl. Run: node scripts/shared-layout.js');
    drift.forEach((d) => console.error('  ' + d.file));
    return 1;
  }
  drift.forEach((d) => fs.writeFileSync(path.join(ROOT, d.file), d.expected));
  console.log(drift.length === 0
    ? 'Nothing to change, ' + managedPages().length + ' pages already match.'
    : 'Updated ' + drift.length + ' of ' + managedPages().length + ' pages:\n  ' + drift.map((d) => d.file).join('\n  '));
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  SITE_PAGES,
  COMPACT_PAGES,
  EXEMPT_PAGES,
  PARTS,
  pageInfo,
  render,
  apply,
  block,
  markerPattern,
  findDrift,
  managedPages
};
