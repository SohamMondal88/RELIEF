/**
 * One way to read search text, for every list that has a search box (hospitals, doctors, pharmacies,
 * first aid, blog). The person's query and the text being searched go through the same steps, so the
 * two sides agree. Nothing here changes what is shown on the page: the normalized text is only used to
 * compare. No DOM access, so node:test can run it.
 *
 * What normalize() does, in this order:
 *  1. Unicode NFKC. Composed and decomposed forms of the same letter become one (for example Bengali
 *     য় typed as one character or as য plus the nukta sign, or é typed as one character or as e plus an
 *     accent), and no-break spaces, full width letters and similar become their plain form.
 *  2. Removes invisible characters that copied text often carries: zero width space, joiner and non
 *     joiner, word joiner, byte order mark, soft hyphen and the left to right / right to left marks.
 *  3. Turns curly quotes into ' and dashes into -, so "Children’s" and "Children's" are the same word.
 *     Other punctuation is kept as it is: "St. Mary's" and "24/7" still need their dot, apostrophe and
 *     slash to match.
 *  4. Folds case (lower case, through upper case so that ß matches ss and the two forms of sigma match).
 *  5. Turns every run of white space into one space and trims the ends.
 *
 * Accents and Bengali vowel signs are not removed: "cafe" does not find "café", because that would also
 * turn one Bengali word into another.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ReliefSearchText = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var INVISIBLE = /[­​-‏‪-‮⁠-⁤﻿]/g;
  var CURLY_APOSTROPHE = /[‘’‛ʼ]/g;
  var CURLY_QUOTE = /[“”‟]/g;
  var DASHES = /[‐-―−]/g;

  function canNormalize() {
    return typeof String.prototype.normalize === 'function';
  }

  function nfkc(text) {
    return canNormalize() ? text.normalize('NFKC') : text;
  }

  // Anything that is not text (null, undefined, a number, an object) is read the way String() reads it,
  // except null and undefined, which are empty.
  function normalize(value) {
    if (value === null || value === undefined) return '';
    var text = nfkc(String(value))
      .replace(INVISIBLE, '')
      .replace(CURLY_APOSTROPHE, "'")
      .replace(CURLY_QUOTE, '"')
      .replace(DASHES, '-');
    // Folding can leave the text in a form that is not normalized (a capital dotted I, for example),
    // so it is normalized once more.
    text = nfkc(text.toUpperCase().toLowerCase());
    return text.replace(/\s+/g, ' ').trim();
  }

  // The words of a query: normalized, split on white space, nothing left for an empty or blank query.
  function tokens(query) {
    var text = normalize(query);
    return text ? text.split(' ') : [];
  }

  // The searchable form of a record: its fields, normalized and joined with one space. Build it once per
  // record, not on every key press. Fields that are missing are skipped.
  function indexText(fields) {
    var list = Array.isArray(fields) ? fields : [fields];
    return list.map(normalize).filter(Boolean).join(' ');
  }

  // True when every word of the query is somewhere in the index. An empty or blank query matches
  // everything, so clearing the box (or typing only spaces) shows the whole list.
  function matchesIndex(index, query) {
    var words = tokens(query);
    if (!words.length) return true;
    return words.every(function (word) { return index.indexOf(word) !== -1; });
  }

  function matches(fields, query) {
    return matchesIndex(indexText(fields), query);
  }

  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

  // The readable text of a trusted HTML snippet (the first aid guide bodies), so a search for "div" or
  // "li" does not find markup. Tags become a space, so the words around a tag stay apart.
  function htmlToText(html) {
    return String(html == null ? '' : html)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (all, name) {
        if (name.charAt(0) === '#') {
          var code = name.charAt(1).toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
          return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : all;
        }
        var known = ENTITIES[name.toLowerCase()];
        return known === undefined ? all : known;
      });
  }

  return {
    normalize: normalize,
    tokens: tokens,
    indexText: indexText,
    matchesIndex: matchesIndex,
    matches: matches,
    htmlToText: htmlToText
  };
});
