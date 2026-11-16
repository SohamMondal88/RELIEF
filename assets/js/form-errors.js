/**
 * Relief Healthcare Platform - Accessible form errors
 *
 * Shows validation results the same way on every form:
 *  - an inline message next to each field, tied to it with aria-describedby
 *  - aria-invalid on the fields that need fixing
 *  - an error summary (role="alert") with a link to each field; focus goes to the
 *    summary when several things need fixing, or straight to the field when only one does
 *  - nothing is cleared: what the user typed stays where it is
 *  - one field can be checked on its own (showFieldError / clearFieldError), and a field's error
 *    goes away as soon as the person edits it (bindFieldClearing)
 *
 * The functions take the document as a parameter so they can be tested without a browser.
 *
 * Implements Issue #65: Add accessible appointment and reminder form validation.
 */

(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    root.ReliefFormErrors = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Turns an errors object into an ordered list for the summary.
   * @param {Object} errors  { fieldKey: message }
   * @param {string[]} order field keys in the order they appear on the page
   * @param {Object} fields  { fieldKey: { focusId, errorId, ... } }
   * @returns {{key: string, message: string, focusId: string|null}[]}
   */
  function buildSummary(errors, order, fields) {
    const source = errors && typeof errors === 'object' ? errors : {};
    const known = Array.isArray(order) ? order : Object.keys(fields || {});
    const items = [];
    const used = {};

    known.forEach(function (key) {
      const message = source[key];
      if (typeof message === 'string' && message.trim() !== '') {
        used[key] = true;
        items.push({ key: key, message: message, focusId: fields && fields[key] ? fields[key].focusId : null });
      }
    });

    // Errors for keys the page has no field for (for example "could not save") still reach the user.
    Object.keys(source).forEach(function (key) {
      if (!used[key] && typeof source[key] === 'string' && source[key].trim() !== '') {
        items.push({ key: key, message: source[key], focusId: null });
      }
    });

    return items;
  }

  function tokens(value) {
    return String(value || '').split(/\s+/).filter(Boolean);
  }

  // A field may already point at its error element in the markup. Only a link added here
  // is removed again, so the static markup is never damaged.
  const ADDED = 'data-error-link-added';

  function addToken(element, name, token) {
    const list = tokens(element.getAttribute(name));
    if (list.indexOf(token) !== -1) return;
    list.push(token);
    element.setAttribute(name, list.join(' '));
    element.setAttribute(ADDED, tokens(element.getAttribute(ADDED)).concat(token).join(' '));
  }

  function removeAddedToken(element, name, token) {
    const added = tokens(element.getAttribute(ADDED));
    if (added.indexOf(token) === -1) return;
    const list = tokens(element.getAttribute(name)).filter(function (t) { return t !== token; });
    if (list.length > 0) element.setAttribute(name, list.join(' '));
    else element.removeAttribute(name);
    const rest = added.filter(function (t) { return t !== token; });
    if (rest.length > 0) element.setAttribute(ADDED, rest.join(' '));
    else element.removeAttribute(ADDED);
  }

  function fieldElement(doc, config) {
    return doc.getElementById(config.groupId || config.focusId);
  }

  /** Removes every error state set by applyErrors. Values the user typed are not touched. */
  function clearErrors(doc, options) {
    const fields = (options && options.fields) || {};
    Object.keys(fields).forEach(function (key) {
      const config = fields[key];
      const target = fieldElement(doc, config);
      const message = config.errorId ? doc.getElementById(config.errorId) : null;
      if (target) {
        target.removeAttribute('aria-invalid');
        if (config.errorId) removeAddedToken(target, 'aria-describedby', config.errorId);
      }
      if (message) {
        message.textContent = '';
        message.hidden = true;
      }
    });
    const summary = options && options.summaryId ? doc.getElementById(options.summaryId) : null;
    if (summary) {
      while (summary.firstChild) summary.removeChild(summary.firstChild);
      summary.hidden = true;
    }
  }

  /**
   * Shows errors. Returns { count, first, focused } where `first` is the key of the first
   * field with a problem and `focused` is what received focus ("summary", "field" or null).
   *
   * options: {
   *   fields:    { key: { focusId, errorId, groupId? } }  // groupId: element that gets aria-invalid (radio groups)
   *   order:     [keys in page order],
   *   summaryId: id of the summary container,
   *   title:     heading of the summary,
   *   focus:     false to skip moving focus
   * }
   */
  function applyErrors(doc, errors, options) {
    const opts = options || {};
    const fields = opts.fields || {};
    clearErrors(doc, opts);

    const items = buildSummary(errors, opts.order, fields);
    let first = null;

    items.forEach(function (item) {
      const config = fields[item.key];
      if (!config) return;
      if (first === null) first = item.key;
      const target = fieldElement(doc, config);
      const message = config.errorId ? doc.getElementById(config.errorId) : null;
      if (message) {
        message.textContent = item.message;
        message.hidden = false;
      }
      if (target) {
        target.setAttribute('aria-invalid', 'true');
        if (config.errorId) addToken(target, 'aria-describedby', config.errorId);
      }
    });

    const summary = opts.summaryId ? doc.getElementById(opts.summaryId) : null;
    if (summary && items.length > 0) {
      renderSummary(doc, summary, items, opts.title || 'Please fix the following');
    }

    let focused = null;
    if (opts.focus !== false && items.length > 0) {
      const showSummary = summary && (items.length > 1 || first === null);
      if (showSummary && typeof summary.focus === 'function') {
        summary.focus();
        focused = 'summary';
      } else if (first !== null) {
        const target = doc.getElementById(fields[first].focusId);
        if (target && typeof target.focus === 'function') {
          target.focus();
          focused = 'field';
        }
      }
    }

    return { count: items.length, first: first, focused: focused };
  }

  /** Marks one field invalid and shows its inline message. Does not touch the summary or focus (use it on blur). */
  function showFieldError(doc, config, message) {
    if (!config) return;
    const target = fieldElement(doc, config);
    const holder = config.errorId ? doc.getElementById(config.errorId) : null;
    if (holder) {
      holder.textContent = message;
      holder.hidden = false;
    }
    if (target) {
      target.setAttribute('aria-invalid', 'true');
      if (config.errorId) addToken(target, 'aria-describedby', config.errorId);
    }
  }

  function tagOf(node) {
    return String(node.tagName || node.tag || '').toLowerCase();
  }

  /**
   * Clears the error of one field and takes it out of the summary. When it was the last problem the
   * summary is hidden. Nothing the user typed is touched and focus stays where it is.
   *
   * options: { fields, summaryId }
   */
  function clearFieldError(doc, key, options) {
    const opts = options || {};
    const config = opts.fields && opts.fields[key];
    if (!config) return;
    const target = fieldElement(doc, config);
    const holder = config.errorId ? doc.getElementById(config.errorId) : null;
    if (target) {
      target.removeAttribute('aria-invalid');
      if (config.errorId) removeAddedToken(target, 'aria-describedby', config.errorId);
    }
    if (holder) {
      holder.textContent = '';
      holder.hidden = true;
    }

    const summary = opts.summaryId ? doc.getElementById(opts.summaryId) : null;
    if (!summary || summary.hidden) return;
    const parts = Array.prototype.slice.call(summary.children || []);
    const title = parts.filter(function (n) { return n.className === 'error-summary-title'; })[0];
    const list = parts.filter(function (n) { return tagOf(n) === 'ul'; })[0];
    if (!list) return;
    Array.prototype.slice.call(list.children || []).forEach(function (li) {
      const link = Array.prototype.slice.call(li.children || []).filter(function (n) {
        return typeof n.getAttribute === 'function' && n.getAttribute('data-focus-id') === config.focusId;
      })[0];
      if (link) list.removeChild(li);
    });
    const left = (list.children || []).length;
    if (left === 0) {
      while (summary.firstChild) summary.removeChild(summary.firstChild);
      summary.hidden = true;
    } else if (title) {
      const base = title.getAttribute('data-title') || 'Please fix the following';
      title.textContent = left === 1 ? base + ' (1 problem)' : base + ' (' + left + ' problems)';
    }
  }

  /**
   * Clears a field's error as soon as the person edits that field (typing, choosing, ticking).
   * Only fields that currently show an error react. The typed value is never changed.
   */
  function bindFieldClearing(doc, options) {
    const opts = options || {};
    const fields = opts.fields || {};
    Object.keys(fields).forEach(function (key) {
      const target = fieldElement(doc, fields[key]);
      if (!target || typeof target.addEventListener !== 'function') return;
      const handler = function () {
        if (target.getAttribute('aria-invalid') === 'true') clearFieldError(doc, key, opts);
      };
      target.addEventListener('input', handler);
      target.addEventListener('change', handler);
    });
  }

  function renderSummary(doc, summary, items, titleText) {
    while (summary.firstChild) summary.removeChild(summary.firstChild);
    summary.hidden = false;

    const title = doc.createElement('p');
    title.className = 'error-summary-title';
    title.setAttribute('data-title', titleText);
    title.textContent = items.length === 1 ? titleText + ' (1 problem)' : titleText + ' (' + items.length + ' problems)';
    summary.appendChild(title);

    const list = doc.createElement('ul');
    items.forEach(function (item) {
      const li = doc.createElement('li');
      if (item.focusId) {
        const link = doc.createElement('a');
        link.href = '#' + item.focusId;
        link.textContent = item.message;
        link.setAttribute('data-focus-id', item.focusId);
        li.appendChild(link);
      } else {
        li.textContent = item.message;
      }
      list.appendChild(li);
    });
    summary.appendChild(list);
  }

  /**
   * Makes a summary link move focus to its field (a plain "#id" link does not focus
   * non-focusable targets in every browser). `beforeFocus` lets a multi-step form show
   * the right step first.
   */
  function bindSummaryLinks(doc, summaryId, beforeFocus) {
    const summary = doc.getElementById(summaryId);
    if (!summary || typeof summary.addEventListener !== 'function') return;
    summary.addEventListener('click', function (event) {
      const target = event.target;
      const link = target && typeof target.closest === 'function' ? target.closest('a[data-focus-id]') : null;
      if (!link) return;
      event.preventDefault();
      const id = link.getAttribute('data-focus-id');
      if (typeof beforeFocus === 'function') beforeFocus(id);
      const field = doc.getElementById(id);
      if (field && typeof field.focus === 'function') field.focus();
    });
  }

  return {
    buildSummary: buildSummary,
    applyErrors: applyErrors,
    clearErrors: clearErrors,
    showFieldError: showFieldError,
    clearFieldError: clearFieldError,
    bindFieldClearing: bindFieldClearing,
    bindSummaryLinks: bindSummaryLinks
  };
});
