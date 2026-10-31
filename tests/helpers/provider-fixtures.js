/**
 * Shared synthetic provider fixtures for the tests (Issue #122).
 *
 * Loads tests/fixtures/providers/synthetic-providers.json and checks any record against the
 * rules in docs/PROVIDER_TEST_FIXTURES.md. Test code only; the site never loads this file.
 *
 *   const fx = require('./helpers/provider-fixtures');
 *   fx.hospitals, fx.doctors, fx.pharmacies, fx.ambulances   // the raw records
 *   fx.get('doctor', 'synthetic-doctor-001')                 // one record (a copy)
 *   fx.validateProvider('ambulance', record)                 // -> list of problems, [] when fine
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'fixtures', 'providers', 'synthetic-providers.json');
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// kind -> key in the fixture file, the id prefix, and the fields that must be non-empty text
const KINDS = {
  hospital: { key: 'hospitals', required: ['name', 'type', 'district'], types: ['hospital', 'phc', 'clinic', 'diagnostic'] },
  doctor: { key: 'doctors', required: ['name', 'specialty', 'district'] },
  pharmacy: { key: 'pharmacies', required: ['name', 'type', 'district'], types: ['pharmacy'] },
  ambulance: { key: 'ambulances', required: ['name', 'serviceType', 'district'], serviceTypes: ['emergency', 'non-emergency', 'both'] }
};

const FAKE_PHONE = /5550/; // fictional exchange, same rule as docs/FACILITY_DATA_CONTRACT.md fixtures
const FAKE_HOST = /(^|\.)example\.org$/i;

function isText(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function checkHours(hours, problems) {
  if (hours === null || hours === undefined) return;
  if (!isText(hours) || hours.length > 200) {
    problems.push('hours must be text of 1 to 200 characters or null');
    return;
  }
  const times = hours.match(/\d{1,2}:\d{2}/g) || [];
  if (!times.length && !/open 24 hours/i.test(hours)) {
    problems.push('hours must say "Open 24 hours" or give times like 9:00-17:00');
  }
  times.forEach((t) => {
    const parts = t.split(':').map(Number);
    if (parts[0] > 23 || parts[1] > 59) problems.push('hours has an impossible time: ' + t);
  });
  const range = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/.exec(hours);
  if (range && range[1] === range[2]) problems.push('hours opens and closes at the same time');
}

function checkWebsite(url, problems) {
  if (url === undefined || url === null) return;
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    problems.push('website is not a valid URL');
    return;
  }
  if (u.protocol !== 'https:') problems.push('website must be https');
  if (u.username || u.password) problems.push('website must not contain credentials');
  if (!FAKE_HOST.test(u.hostname)) problems.push('website must be on example.org so it cannot point at a real provider');
}

function checkCoordinates(record, problems) {
  const hasLat = record.lat !== undefined && record.lat !== null;
  const hasLng = record.lng !== undefined && record.lng !== null;
  if (hasLat !== hasLng) {
    problems.push('give lat and lng together or neither');
    return;
  }
  if (!hasLat) return;
  if (typeof record.lat !== 'number' || typeof record.lng !== 'number' || !isFinite(record.lat) || !isFinite(record.lng)) {
    problems.push('lat and lng must be numbers');
  } else if (record.lat < -90 || record.lat > 90 || record.lng < -180 || record.lng > 180) {
    problems.push('lat or lng is out of range');
  } else if (record.lat === 0 && record.lng === 0) {
    problems.push('0,0 is not a real place');
  }
}

/** Returns a list of problems for one fixture record of the given kind. Empty list means it is fine. */
function validateProvider(kind, record) {
  const spec = KINDS[kind];
  const problems = [];
  if (!spec) return ['unknown kind: ' + kind];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return ['record must be an object'];

  if (record.synthetic !== true) problems.push('synthetic must be true');
  if (!new RegExp('^synthetic-' + kind + '-\\d{3}$').test(String(record.id))) {
    problems.push('id must look like synthetic-' + kind + '-001');
  }
  spec.required.forEach((field) => {
    if (!isText(record[field])) problems.push(field + ' is required');
  });
  if (spec.types && isText(record.type) && spec.types.indexOf(record.type) === -1) {
    problems.push('type must be one of ' + spec.types.join(', '));
  }
  if (spec.serviceTypes && isText(record.serviceType) && spec.serviceTypes.indexOf(record.serviceType) === -1) {
    problems.push('serviceType must be one of ' + spec.serviceTypes.join(', '));
  }

  // Test data must never read as verified live provider data.
  if (record.verified === true) problems.push('verified must not be true');
  ['source', 'lastChecked'].forEach((field) => {
    if (record[field] !== undefined && record[field] !== null) problems.push(field + ' must be absent (nothing here has a real source)');
  });

  if (record.phone !== undefined && record.phone !== null) {
    if (!isText(record.phone) || !FAKE_PHONE.test(record.phone)) problems.push('phone must use the fictional 5550 exchange');
    else if (!/^[\d\s+()\-.]+$/.test(record.phone) || record.phone.replace(/\D/g, '').length < 7 || record.phone.replace(/\D/g, '').length > 15) {
      problems.push('phone must be 7 to 15 digits');
    }
  }
  checkHours(record.hours, problems);
  checkCoordinates(record, problems);
  checkWebsite(record.website, problems);
  if (/@/.test(JSON.stringify(record))) problems.push('no email addresses in fixtures');
  if (/[<>]/.test(JSON.stringify(record))) problems.push('no markup in fixtures');
  return problems;
}

/** Same checks for every record in the file, plus unique ids and doctor -> hospital links. */
function validateAll(file) {
  const out = [];
  const ids = new Set();
  const hospitalIds = new Set((file.hospitals || []).map((h) => h.id));
  if (file.synthetic !== true) out.push('file: synthetic must be true');
  if (file.schemaVersion !== 1) out.push('file: schemaVersion must be 1');
  Object.keys(KINDS).forEach((kind) => {
    const list = file[KINDS[kind].key];
    if (!Array.isArray(list) || !list.length) {
      out.push('file: ' + KINDS[kind].key + ' must be a non-empty list');
      return;
    }
    list.forEach((record) => {
      validateProvider(kind, record).forEach((p) => out.push(kind + ' ' + (record && record.id) + ': ' + p));
      if (record && ids.has(record.id)) out.push(kind + ' ' + record.id + ': duplicate id');
      if (record) ids.add(record.id);
      if (kind === 'doctor' && record.facilityId && !hospitalIds.has(record.facilityId)) {
        out.push('doctor ' + record.id + ': facilityId points at no hospital fixture');
      }
    });
  });
  return out;
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function get(kind, id) {
  const spec = KINDS[kind];
  const found = spec && data[spec.key].find((r) => r.id === id);
  if (!found) throw new Error('No ' + kind + ' fixture with id ' + id);
  return clone(found);
}

module.exports = {
  FILE,
  KINDS,
  data: clone(data),
  hospitals: clone(data.hospitals),
  doctors: clone(data.doctors),
  pharmacies: clone(data.pharmacies),
  ambulances: clone(data.ambulances),
  get,
  validateProvider,
  validateAll
};
