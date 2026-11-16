/*
 * RELIEF safe HTML helpers.
 *
 * Anything that is put into a template string and then into innerHTML has to go
 * through one of these first, so text that came from a server, a JSON file or
 * browser storage can never turn into markup.
 *
 *   escapeHtml(value)  text for an element body or a quoted attribute value
 *   cssUrl(value)      a complete `url("...")` for a style attribute, or `none`
 *   safeUrl(value)     the value if it is a relative path or http(s), else ''
 *
 * The one place that intentionally keeps trusted rich HTML is the body of the
 * first aid guides in firstaid.js (see docs/FIRST_AID_REVIEW_CHECKLIST.md).
 *
 * Works in the browser (window.ReliefSafeHtml) and in node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ReliefSafeHtml = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Safe in an element body and inside a single or double quoted attribute.
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Relative paths and http(s) only. Anything with another scheme (javascript:, data:,
  // vbscript:, file:) gives ''. Control characters and spaces are removed before the
  // scheme check because browsers ignore them inside a scheme ("java\tscript:").
  function safeUrl(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    var compact = raw.replace(/[\u0000- \u007f-\u009f]/g, '');
    var scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
    if (scheme && scheme[1].toLowerCase() !== 'http' && scheme[1].toLowerCase() !== 'https') return '';
    return raw;
  }

  // A CSS url() for use in a style attribute. The caller still has to escapeHtml() the
  // result when it goes inside the quotes of the attribute. Characters that could end the
  // url("...") token or the declaration are percent encoded, which names the same address.
  function cssUrl(value) {
    var url = safeUrl(value);
    if (!url) return 'none';
    var encoded = url.replace(/[\u0000- "'()\\<>`{};\u007f]/g, function (ch) {
      return '%' + ('0' + ch.charCodeAt(0).toString(16).toUpperCase()).slice(-2);
    });
    return 'url("' + encoded + '")';
  }

  return {
    escapeHtml: escapeHtml,
    safeUrl: safeUrl,
    cssUrl: cssUrl
  };
});
