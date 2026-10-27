/**
 * Relief Healthcare Platform - Facility data contract
 *
 * Defines what a facility record must look like and checks records before the
 * directory uses them. A record that breaks the contract is quarantined (kept out
 * of search results and listed with the reasons) instead of breaking the page.
 *
 * Pure functions, no DOM, so they run in the browser and under node:test.
 * The contract is documented in docs/FACILITY_DATA_CONTRACT.md.
 *
 * Implements Issue #61: Add contract tests for healthcare facility data.
 */

(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    root.FacilitySchema = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Bump when a change can break a reader (a field removed, renamed or made required).
  // Adding an optional field does not change the version. See the doc for the policy.
  const SCHEMA_VERSION = 1;

  const KNOWN_TYPES = ['hospital', 'phc', 'clinic', 'pharmacy', 'diagnostic'];

  const REQUIRED_FIELDS = ['id', 'name', 'type', 'district'];
  const OPTIONAL_FIELDS = ['address', 'phone', 'hours', 'services', 'lat', 'lng', 'verified', 'source', 'lastChecked'];

  const LIMITS = {
    id: 64,
    name: 200,
    district: 100,
    address: 300,
    hours: 200,
    source: 300,
    service: 80,
    services: 40
  };

  // West Bengal and a margin. A point outside is a warning (a typo is likely), not an error.
  const REGION = { latMin: 21.4, latMax: 27.4, lngMin: 85.7, lngMax: 89.95 };

  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
  const PHONE = /^\+?[\d\s\-().]+$/;

  function isText(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function hasMarkup(value) {
    return /[<>]/.test(value);
  }

  function isRealDate(text) {
    if (!DATE_ONLY.test(text)) return false;
    const date = new Date(text + 'T00:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
  }

  function digitCount(text) {
    return (text.match(/\d/g) || []).length;
  }

  function checkText(record, field, max, errors, required) {
    const value = record[field];
    if (value === undefined || value === null) {
      if (required) errors.push(field + ' is required');
      return;
    }
    if (typeof value !== 'string') {
      errors.push(field + ' must be text');
      return;
    }
    if (required && !isText(value)) {
      errors.push(field + ' must not be empty');
      return;
    }
    if (value.length > max) errors.push(field + ' is longer than ' + max + ' characters');
    if (hasMarkup(value)) errors.push(field + ' must not contain < or >');
  }

  /**
   * Checks one record.
   * @returns {{valid: boolean, errors: string[], warnings: string[]}}
   */
  function validateFacility(record, now) {
    const errors = [];
    const warnings = [];

    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return { valid: false, errors: ['record must be an object'], warnings: warnings };
    }

    // Required identity fields.
    if (typeof record.id !== 'string' && typeof record.id !== 'number') {
      errors.push('id is required');
    } else if (!isText(String(record.id))) {
      errors.push('id must not be empty');
    } else if (String(record.id).length > LIMITS.id) {
      errors.push('id is longer than ' + LIMITS.id + ' characters');
    } else if (hasMarkup(String(record.id))) {
      errors.push('id must not contain < or >');
    }
    checkText(record, 'name', LIMITS.name, errors, true);
    checkText(record, 'type', 40, errors, true);
    checkText(record, 'district', LIMITS.district, errors, true);

    // An unknown type still shows up (type is free text for the page), but is reported.
    if (isText(record.type) && KNOWN_TYPES.indexOf(record.type) === -1) {
      warnings.push('unknown type "' + String(record.type).slice(0, 40) + '"');
    }

    // Optional text fields: absent or null is fine.
    checkText(record, 'address', LIMITS.address, errors, false);
    checkText(record, 'hours', LIMITS.hours, errors, false);
    checkText(record, 'source', LIMITS.source, errors, false);

    if (record.phone !== undefined && record.phone !== null) {
      if (typeof record.phone !== 'string') {
        errors.push('phone must be text');
      } else if (!PHONE.test(record.phone) || digitCount(record.phone) < 7 || digitCount(record.phone) > 15) {
        errors.push('phone must have 7 to 15 digits and only digits, spaces, +, -, ( and )');
      }
    }

    if (record.services !== undefined && record.services !== null) {
      if (!Array.isArray(record.services)) {
        errors.push('services must be a list');
      } else {
        if (record.services.length > LIMITS.services) errors.push('services has more than ' + LIMITS.services + ' items');
        record.services.forEach(function (service, i) {
          if (!isText(service)) errors.push('services[' + i + '] must be non-empty text');
          else if (service.length > LIMITS.service) errors.push('services[' + i + '] is too long');
          else if (hasMarkup(service)) errors.push('services[' + i + '] must not contain < or >');
        });
      }
    }

    // Coordinates: both or neither, valid numbers.
    const hasLat = record.lat !== undefined && record.lat !== null;
    const hasLng = record.lng !== undefined && record.lng !== null;
    if (hasLat !== hasLng) {
      errors.push('lat and lng must be given together');
    } else if (hasLat) {
      let coordsOk = true;
      if (typeof record.lat !== 'number' || !Number.isFinite(record.lat) || record.lat < -90 || record.lat > 90) {
        errors.push('lat must be a number between -90 and 90');
        coordsOk = false;
      }
      if (typeof record.lng !== 'number' || !Number.isFinite(record.lng) || record.lng < -180 || record.lng > 180) {
        errors.push('lng must be a number between -180 and 180');
        coordsOk = false;
      }
      if (coordsOk) {
        if (record.lat === 0 && record.lng === 0) {
          errors.push('coordinates 0,0 are not a real location');
        } else if (record.lat < REGION.latMin || record.lat > REGION.latMax || record.lng < REGION.lngMin || record.lng > REGION.lngMax) {
          warnings.push('coordinates are outside West Bengal');
        }
      }
    }

    // Verification must be backed by evidence.
    if (record.verified !== undefined && record.verified !== null && typeof record.verified !== 'boolean') {
      errors.push('verified must be true or false');
    }
    if (record.lastChecked !== undefined && record.lastChecked !== null) {
      const today = new Date(now !== undefined ? now : Date.now()).toISOString().slice(0, 10);
      if (typeof record.lastChecked !== 'string' || !isRealDate(record.lastChecked)) {
        errors.push('lastChecked must be a real date written YYYY-MM-DD');
      } else if (record.lastChecked > today) {
        errors.push('lastChecked is in the future');
      }
    }
    if (record.verified === true) {
      if (!isText(record.source)) errors.push('a verified facility needs a source');
      if (!isText(record.lastChecked)) errors.push('a verified facility needs lastChecked');
    }

    return { valid: errors.length === 0, errors: errors, warnings: warnings };
  }

  /**
   * Checks a whole dataset (the object in facilities.json, or a bare list).
   *
   * @returns {{
   *   ok: boolean,                 // the file itself is usable
   *   schemaVersion: number|null,
   *   problems: string[],          // file-level problems
   *   accepted: Object[],          // records that passed
   *   quarantined: {index:number, id:string|null, errors:string[]}[],
   *   warnings: {index:number, id:string|null, warnings:string[]}[]
   * }}
   */
  function validateDataset(data, now) {
    const result = { ok: false, schemaVersion: null, problems: [], accepted: [], quarantined: [], warnings: [] };

    let list = null;
    if (Array.isArray(data)) {
      list = data;
    } else if (data && typeof data === 'object' && Array.isArray(data.facilities)) {
      list = data.facilities;
      if (data.schemaVersion !== undefined) {
        if (!Number.isInteger(data.schemaVersion)) {
          result.problems.push('schemaVersion must be a whole number');
        } else {
          result.schemaVersion = data.schemaVersion;
          if (data.schemaVersion > SCHEMA_VERSION) {
            result.problems.push('data uses schema version ' + data.schemaVersion + ' but this site understands up to ' + SCHEMA_VERSION);
          }
        }
      }
    } else {
      result.problems.push('expected a list of facilities or an object with a "facilities" list');
      return result;
    }

    if (result.problems.length > 0) return result;

    const seen = {};
    list.forEach(function (record, index) {
      const check = validateFacility(record, now);
      const id = record && typeof record === 'object' && record.id !== undefined && record.id !== null ? String(record.id) : null;
      const errors = check.errors.slice();

      if (id !== null && check.valid) {
        if (seen[id] !== undefined) errors.push('duplicate id (first used at position ' + seen[id] + ')');
        else seen[id] = index;
      }

      if (errors.length > 0) {
        result.quarantined.push({ index: index, id: id, errors: errors });
        return;
      }
      result.accepted.push(record);
      if (check.warnings.length > 0) result.warnings.push({ index: index, id: id, warnings: check.warnings });
    });

    result.ok = true;
    return result;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    KNOWN_TYPES: KNOWN_TYPES,
    REQUIRED_FIELDS: REQUIRED_FIELDS,
    OPTIONAL_FIELDS: OPTIONAL_FIELDS,
    LIMITS: LIMITS,
    validateFacility: validateFacility,
    validateDataset: validateDataset
  };
});
