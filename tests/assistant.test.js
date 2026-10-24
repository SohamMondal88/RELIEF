const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { routeMessage, safeRoute, MAX_LENGTH, LINKS, NAVIGATION } = require('../assets/js/assistant.js');

const pagesDir = path.join(__dirname, '..', 'pages');

describe('Relief Assistant routing', () => {
    it('handles empty and whitespace input', () => {
        assert.strictEqual(routeMessage('').type, 'empty');
        assert.strictEqual(routeMessage('   ').type, 'empty');
        assert.strictEqual(routeMessage(null).type, 'empty');
    });

    it('handles very long input without routing it', () => {
        const r = routeMessage('hospital '.repeat(200));
        assert.strictEqual(r.type, 'too_long');
        assert.ok(r.text.includes(String(MAX_LENGTH)));
        assert.ok(r.links.some(l => l.href.includes('emergency-sos')));
    });

    const urgent = [
        'I have chest pain',
        'pain in my chest and arm',
        'I cannot breathe',
        'she is struggling to breathe',
        'my father has slurred speech and face drooping',
        'he is having a seizure',
        'vomiting blood',
        'severe bleeding that will not stop',
        'my brother passed out',
        'throat closing up after peanuts',
        'worst headache of my life'
    ];
    urgent.forEach(phrase => {
        it('escalates urgent phrase: ' + phrase, () => {
            const r = routeMessage(phrase);
            assert.strictEqual(r.type, 'urgent');
            assert.strictEqual(r.alert, true);
            assert.match(r.text, /emergency services/i);
            const hrefs = r.links.map(l => l.href);
            assert.ok(hrefs.includes(LINKS.sos.href));
            assert.ok(hrefs.includes(LINKS.firstAid.href));
            assert.doesNotMatch(r.text, /\b\d+\s*mg\b|you (have|probably have)/i);
        });
    });

    it('urgent signs win over a medicine question', () => {
        assert.strictEqual(routeMessage('chest pain, what dose of aspirin should I take?').type, 'urgent');
    });

    it('does not escalate negated signs', () => {
        assert.notStrictEqual(routeMessage('I have no chest pain').type, 'urgent');
        assert.notStrictEqual(routeMessage('no chest pain, just a mild cough').type, 'urgent');
    });

    it('still escalates after an unrelated negation', () => {
        assert.strictEqual(routeMessage('no fever, but severe chest pain').type, 'urgent');
    });

    const advice = [
        'What dose of paracetamol should I take?',
        'how many tablets of ibuprofen can I take',
        'can I take antibiotics with alcohol',
        'which medicine for fever',
        'do I have diabetes',
        'is it safe to take 500 mg twice a day'
    ];
    advice.forEach(phrase => {
        it('refuses medical advice: ' + phrase, () => {
            const r = routeMessage(phrase);
            assert.strictEqual(r.type, 'medical_advice');
            assert.match(r.text, /can't give medical advice/);
            const hrefs = r.links.map(l => l.href);
            assert.ok(hrefs.includes(LINKS.symptoms.href));
            assert.ok(hrefs.includes(LINKS.firstAid.href));
        });
    });

    it('routes navigation intents', () => {
        const cases = {
            'Find nearby hospitals': 'hospitals',
            'Book doctor appointment': 'appointments',
            'First aid tips': 'firstAid',
            'I need an ambulance number': 'ambulances',
            'where is a pharmacy': 'pharmacies',
            'compare plans': 'subscription',
            'I want to see a doctor': 'doctors'
        };
        Object.keys(cases).forEach(q => {
            const r = routeMessage(q);
            assert.strictEqual(r.type, 'navigation', q);
            assert.strictEqual(r.intent, cases[q], q);
        });
    });

    it('every link points to a page that exists', () => {
        const all = new Set(Object.values(LINKS));
        const hrefs = Array.from(all).map(l => l.href);
        assert.ok(hrefs.length >= 8);
        hrefs.forEach(href => {
            assert.ok(href.startsWith('./'), href);
            const file = href.slice(2).split('#')[0];
            assert.ok(fs.existsSync(path.join(pagesDir, file)), href + ' does not exist');
        });
        NAVIGATION.forEach(n => assert.ok(LINKS[n.key], n.key));
    });

    it('does not over-promise', () => {
        const texts = NAVIGATION.map(n => n.text).concat(routeMessage('hello there').text);
        texts.forEach(t => assert.doesNotMatch(t, /instantly|in minutes/i));
    });

    it('falls back for unknown input', () => {
        const r = routeMessage('tell me a joke');
        assert.strictEqual(r.type, 'fallback');
        assert.ok(r.links.length > 0);
    });

    it('returns a safe retryable message when routing throws', () => {
        const r = safeRoute('hello', { detect: () => { throw new Error('boom'); } });
        assert.strictEqual(r.type, 'error');
        assert.strictEqual(r.retry, true);
        assert.match(r.text, /emergency services/i);
        assert.doesNotMatch(r.text, /boom/);
    });

    it('does not store or log user text', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'assistant.js'), 'utf8');
        assert.doesNotMatch(src, /localStorage|sessionStorage|console\.|fetch\(|XMLHttpRequest/);
    });
});
