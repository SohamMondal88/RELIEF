/**
 * Shared email and phone checks (Issue #197): international phone layouts, boundary lengths,
 * surrounding whitespace, blank optional values, that every form uses the same rules, and
 * that every page which needs validators.js loads it first.
 *
 * node --test tests/validators.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const V = require('../assets/js/validators.js');
const Request = require('../assets/js/appointment-request.js');
const Events = require('../assets/js/health-events.js');
const Corrections = require('../assets/js/facility-corrections.js');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('isEmail', () => {
  it('accepts ordinary and less common valid addresses', () => {
    [
      'a@b.co', 'asha.rao@example.com', 'first+tag@example.org', 'x_y-z@mail.example.co.in',
      'o\'brien@example.ie', '1234@example.com', 'a@xn--80ak6aa92e.com', 'অভি@example.in', 'user@exämple.de',
      'a@b-c.co', 'a@123.example.com'
    ].forEach((email) => assert.strictEqual(V.isEmail(email), true, email));
  });

  it('rejects the shapes the old pasted regex let through', () => {
    ['a@b..c', '..a@b.co', 'a..b@c.co', '.a@b.co', 'a.@b.co', 'a@.b.co', 'a@b.co.', 'a@b.', 'a@-b.co', 'a@b-.co']
      .forEach((email) => assert.strictEqual(V.isEmail(email), false, email));
  });

  it('rejects missing parts, extra @, spaces, brackets and numeric or one letter endings', () => {
    ['', 'plain', '@b.co', 'a@', 'a@b', 'a@@b.co', 'a@b@c.co', 'a b@c.co', 'a@b c.co', 'a@b.c', 'a@b.123', '<a@b.co>', 'a(b)@c.co', 'a,b@c.co', '"a"@b.co']
      .forEach((email) => assert.strictEqual(V.isEmail(email), false, JSON.stringify(email)));
  });

  it('ignores whitespace around the address and nothing else', () => {
    assert.strictEqual(V.isEmail('  a@b.co  '), true);
    assert.strictEqual(V.isEmail('\ta@b.co\n'), true);
    assert.strictEqual(V.isEmail('a @b.co'), false);
  });

  it('is false for anything that is not a string', () => {
    [null, undefined, 5, {}, [], ['a@b.co']].forEach((v) => assert.strictEqual(V.isEmail(v), false));
  });

  it('keeps the length limits at the boundary: 254 in all, 64 before the @, 63 per label', () => {
    const local64 = 'a'.repeat(64);
    assert.strictEqual(V.isEmail(local64 + '@example.com'), true);
    assert.strictEqual(V.isEmail('a'.repeat(65) + '@example.com'), false);

    const label63 = 'b'.repeat(63);
    assert.strictEqual(V.isEmail('a@' + label63 + '.com'), true);
    assert.strictEqual(V.isEmail('a@' + label63 + 'b.com'), false);

    // 64 + 1 + 189 = 254: three labels of 63 plus the dots and "com"
    const domain = [label63, label63, label63.slice(0, 57), 'com'].join('.');
    const at254 = local64 + '@' + domain;
    assert.strictEqual(at254.length, 254);
    assert.strictEqual(V.isEmail(at254), true);
    assert.strictEqual(V.isEmail(local64 + '@' + domain.replace('com', 'comm')), false);
  });
});

describe('isPhone', () => {
  it('accepts common layouts from different countries', () => {
    [
      '+91 98765 43210', '098765 43210', '9876543210', '+91-98765-43210',
      '(415) 555-0132', '415.555.0132', '+1 (415) 555-0132', '+1-415-555-0132',
      '+44 20 7946 0958', '+44 (0)20 7946 0958', '020 7946 0958', '00 44 20 7946 0958', '0044 20 7946 0958',
      '+49 30 901820', '+81 3-1234-5678', '+61 2 9876 5432', '+971 4 123 4567', '+880 1712-345678',
      '1800-345-6789', '033 2241 4239', '+91 3242 250 201'
    ].forEach((phone) => assert.strictEqual(V.isPhone(phone), true, phone));
  });

  it('rejects letters, stray symbols, unpaired or nested brackets and a "+" in the middle', () => {
    ['call me', '555-CALL', '+91 abc', '98765 43210 ext 5', '12-34-56-x', '(415 555-0132', '415) 555-0132', '((415)) 555-0132', '98765+43210', '- 123 4567', '++9198765432', '+', '00', '()']
      .forEach((phone) => assert.strictEqual(V.isPhone(phone), false, phone));
  });

  it('counts 7 to 15 digits, and does not count the "+" or the "00" in front', () => {
    assert.strictEqual(V.isPhone('123456'), false);
    assert.strictEqual(V.isPhone('1234567'), true);
    assert.strictEqual(V.isPhone('123456789012345'), true);
    assert.strictEqual(V.isPhone('1234567890123456'), false);
    assert.strictEqual(V.isPhone('+123456789012345'), true);
    assert.strictEqual(V.isPhone('+1234567890123456'), false);
    assert.strictEqual(V.isPhone('00 123456789012345'), true);
    assert.strictEqual(V.isPhone('00 1234567890123456'), false);
    assert.strictEqual(V.isPhone('00 123456'), false);
    assert.strictEqual(V.phoneDigits('00 44 20'), '4420');
    assert.strictEqual(V.phoneDigits('+44 20'), '4420');
    assert.strictEqual(V.phoneDigits('call'), '');
  });

  it('limits the typed length, spaces and brackets included', () => {
    assert.strictEqual(V.isPhone('+1 415 555 0132' + ' '.repeat(17) + ''), true, 'trailing spaces are trimmed first');
    assert.strictEqual(V.isPhone('1 ' + '2 '.repeat(15) + '3'), false, '34 characters');
    assert.strictEqual(V.isPhone('1 2 3 4 5 6 7 8 9 0 1 2 3 4 5'), true, '29 characters, 15 digits');
  });

  it('ignores whitespace around the number', () => {
    assert.strictEqual(V.isPhone('  (415) 555-0132 '), true);
    assert.strictEqual(V.isPhone('\n+44 20 7946 0958\t'), true);
  });

  it('is false for anything that is not a string', () => {
    [null, undefined, 9876543210, {}, []].forEach((v) => assert.strictEqual(V.isPhone(v), false));
  });
});

describe('check (required and optional values)', () => {
  it('a blank optional value is ok, spaces only counts as blank', () => {
    ['email', 'phone'].forEach((kind) => {
      ['', '   ', '\n\t', null, undefined].forEach((blank) => {
        assert.deepStrictEqual(V.check(kind, blank), { ok: true, value: '', reason: null });
        assert.deepStrictEqual(V.check(kind, blank, { required: false }), { ok: true, value: '', reason: null });
      });
    });
  });

  it('a blank required value says blank', () => {
    ['email', 'phone'].forEach((kind) => {
      ['', '   ', undefined].forEach((blank) => {
        assert.deepStrictEqual(V.check(kind, blank, { required: true }), { ok: false, value: '', reason: 'blank' });
      });
    });
  });

  it('returns the trimmed value to keep', () => {
    assert.deepStrictEqual(V.check('email', '  a@b.co ', { required: true }), { ok: true, value: 'a@b.co', reason: null });
    assert.deepStrictEqual(V.check('phone', ' (415) 555-0132 '), { ok: true, value: '(415) 555-0132', reason: null });
  });

  it('tells invalid from too long, so a form can show the right message', () => {
    assert.strictEqual(V.check('email', 'a@b..c').reason, 'invalid');
    assert.strictEqual(V.check('email', 'a'.repeat(250) + '@b.co').reason, 'too-long');
    assert.strictEqual(V.check('phone', 'call me').reason, 'invalid');
    assert.strictEqual(V.check('phone', '1'.repeat(40)).reason, 'too-long');
  });

  it('refuses a kind it does not know instead of passing everything', () => {
    assert.throws(() => V.check('postcode', '12345'), /unknown kind/);
  });
});

describe('every form uses the shared rules', () => {
  const edgeEmails = ['a@b..c', '..a@b.co'];

  it('appointment request: bad emails are refused, the Indian mobile rule is kept', () => {
    const base = { doctor: { id: 'd1', name: 'Dr. Example' }, date: '2026-10-30', timeWindow: 'morning', name: 'Asha Rao', email: 'asha@example.com', phone: '+91 98765 43210', notes: '', consent: true };
    const errors = (patch) => Request.validateRequest(Object.assign({}, base, patch), { now: new Date(2026, 9, 27, 10, 0, 0) }).errors;
    assert.deepStrictEqual(errors({}), {}, 'the base request is valid');
    edgeEmails.forEach((email) => assert.ok(errors({ email }).email, email));
    assert.strictEqual(errors({ email: '  asha@example.com ' }).email, undefined);
    // the appointment form only takes Indian mobiles or "+" numbers, so a landline and a bracket number stay refused
    ['033 2241 4239', '(415) 555-0132'].forEach((phone) => assert.ok(errors({ phone }).phone, phone));
    assert.strictEqual(errors({ phone: '+44 20 7946 0958' }).phone, undefined);
  });

  describe('health events', () => {
    const base = {
      title: 'Free Eye Camp', type: 'screening', startDate: '10-11-2026', startTime: '09:00', endDate: '', endTime: '15:00',
      district: 'Purulia', venue: 'Community hall, Raghunathpur', organiser: 'Lions Club Purulia',
      services: 'Vision test, Cataract screening', eligibility: 'Everyone', contactPhone: '+91 98300 12345', contactEmail: ''
    };
    const errors = (patch) => Events.validateSubmission(Object.assign({}, base, patch), { now: Date.parse('2026-10-28T06:00:00Z') }).errors;

    it('takes phone numbers that start with a bracket or 00', () => {
      assert.deepStrictEqual(errors({}), {}, 'the base submission is valid');
      ['(415) 555-0132', '00 44 20 7946 0958', '+44 (0)20 7946 0958'].forEach((contactPhone) => {
        assert.strictEqual(errors({ contactPhone }).contactPhone, undefined, contactPhone);
      });
      assert.ok(errors({ contactPhone: 'call me' }).contactPhone);
    });

    it('refuses the bad emails, and an empty optional email or phone is fine', () => {
      edgeEmails.forEach((contactEmail) => assert.ok(errors({ contactEmail }).contactEmail, contactEmail));
      assert.strictEqual(errors({ contactEmail: ' camp@example.org ' }).contactEmail, undefined);
      assert.strictEqual(errors({ contactPhone: '', contactEmail: 'camp@example.org' }).contactPhone, undefined);
      assert.strictEqual(errors({ contactPhone: '+91 98300 12345', contactEmail: '' }).contactEmail, undefined);
    });
  });

  describe('facility corrections', () => {
    const facilities = [{ id: 'fac-001', name: 'Alpha Hospital', type: 'hospital', district: 'Bankura', address: '1 Main Road, Bankura', phone: '+91 3242 250 201', hours: 'Mon to Sat 9:00 to 17:00', services: ['Emergency Care'], verified: true, source: 'WB Health Dept', lastChecked: '2026-10-01' }];
    const submit = (patch) => Corrections.validateSubmission(Object.assign({ facilityId: 'fac-001', field: 'hours', proposedValue: 'Mon to Fri 8:00 to 20:00', sourceUrl: '', contact: '' }, patch), { facilities });

    it('takes bracket and 00 phone numbers as the contact and as a proposed phone', () => {
      assert.deepStrictEqual(submit({}).errors, {}, 'the base correction is valid');
      ['(415) 555-0132', '00 44 20 7946 0958'].forEach((contact) => assert.strictEqual(submit({ contact }).errors.contact, undefined, contact));
      ['(415) 555-0132', '00 44 20 7946 0958'].forEach((proposedValue) => {
        assert.strictEqual(submit({ field: 'phone', proposedValue }).errors.proposedValue, undefined, proposedValue);
      });
    });

    it('refuses bad emails as the contact, a blank contact stays fine', () => {
      edgeEmails.forEach((contact) => assert.ok(submit({ contact }).errors.contact, contact));
      assert.strictEqual(submit({ contact: '   ' }).errors.contact, undefined);
    });
  });
});

describe('blog newsletter box', () => {
  // Runs the real blog.js against a fake page where every element exists but the newsletter input and button are ours.
  function newsletter(typed) {
    const alerts = [];
    const generic = () => ({ dataset: {}, classList: { add() {}, remove() {} }, addEventListener() {}, querySelector: generic, getBoundingClientRect: () => ({ top: 0 }) });
    const input = { value: typed };
    let click;
    const form = { querySelector: (s) => (s === 'input' ? input : { addEventListener: (type, fn) => { click = fn; } }) };
    const handlers = [];
    const document = {
      addEventListener: (type, fn) => handlers.push(fn),
      querySelector: (s) => (s === '.newsletter-form' ? form : generic()),
      querySelectorAll: () => []
    };
    const window = { scrollY: 0, innerHeight: 800, addEventListener() {}, matchMedia: () => ({ matches: false }) };
    vm.runInNewContext(read('assets/js/blog.js'), { document, window, alert: (m) => alerts.push(m), ReliefValidators: V });
    handlers.forEach((fn) => fn());
    click({ preventDefault() {} });
    return { alerts, input };
  }

  it('refuses a value that only has an @ in it', () => {
    ['x@y', '@', 'a@b..c', ' '].forEach((typed) => {
      assert.deepStrictEqual(newsletter(typed).alerts, ['Please enter a valid email address'], JSON.stringify(typed));
    });
  });

  it('accepts a good address with spaces around it, says it without the spaces and clears the box', () => {
    const result = newsletter('  reader@example.org ');
    assert.deepStrictEqual(result.alerts, ['Thank you for subscribing with reader@example.org!']);
    assert.strictEqual(result.input.value, '');
  });
});

describe('pages load validators.js before the scripts that use it', () => {
  const CONSUMERS = ['api', 'contact', 'appointment-request', 'health-events', 'facility-corrections', 'blog'];
  const pages = fs.readdirSync(path.join(ROOT, 'pages')).filter((f) => f.endsWith('.html')).map((f) => 'pages/' + f);

  it('the pages that need it all have the script tag, ahead of the first script that uses it', () => {
    const needing = [];
    pages.forEach((page) => {
      const html = read(page);
      const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="[^"]*assets\/js\/([\w-]+)\.js"/g)].map((m) => m[1]);
      const uses = scripts.filter((s) => CONSUMERS.includes(s)).concat(/id="(login|signup)-form"/.test(html) ? ['main'] : []);
      if (!uses.length) return;
      needing.push(page);
      const own = scripts.indexOf('validators');
      assert.ok(own !== -1, page + ' loads ' + uses.join(', ') + ' but not validators.js');
      assert.ok(own < Math.min(...uses.map((u) => scripts.indexOf(u))), page + ' loads validators.js after a script that uses it');
    });
    ['blog', 'appointments', 'contact', 'login', 'signup', 'health-events', 'hospitals'].forEach((name) => {
      assert.ok(needing.includes('pages/' + name + '.html'), name + ' should be among the pages that need it');
    });
  });

  it('is saved for offline use because a saved page (hospitals) loads it', () => {
    assert.match(read('sw.js'), /'assets\/js\/validators\.js'/);
  });

  it('the old pasted email expression is gone from the scripts', () => {
    const dir = path.join(ROOT, 'assets', 'js');
    fs.readdirSync(dir).filter((f) => f.endsWith('.js')).forEach((file) => {
      assert.doesNotMatch(read('assets/js/' + file), /\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+/, file + ' still has its own email expression');
    });
  });
});
