// Page weight (Issue #95): below-the-fold pictures are lazy and have a size, the analytics script does not
// block the page, the biggest pictures stay small, and nothing critical was deferred.
// See docs/PAGE_WEIGHT.md.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const size = (rel) => fs.statSync(path.join(root, rel)).size;

const PAGES = ['index.html', 'pages/hospitals.html', 'pages/ambulances.html'];

function images(html) {
  return (html.match(/<img\b[^>]*>/g) || []).map((tag) => ({
    tag,
    src: (tag.match(/\ssrc="([^"]+)"/) || [])[1],
    width: (tag.match(/\swidth="(\d+)"/) || [])[1],
    height: (tag.match(/\sheight="(\d+)"/) || [])[1],
    lazy: /\sloading="lazy"/.test(tag)
  }));
}

// The pictures that are on the first screen, so they must not be lazy: the brand logo (the page header and the
// landing splash) and the home page hero photo.
const FIRST_SCREEN = /assets\/images\/(logo\.jpg|hero-image\.jpeg)$/;

test('every picture on home, hospitals and ambulances has a width and a height', () => {
  PAGES.forEach((p) => {
    images(read(p)).forEach((img) => {
      assert.ok(img.width && img.height, p + ': ' + img.tag);
      assert.ok(Number(img.width) > 0 && Number(img.height) > 0, p + ': ' + img.tag);
    });
  });
});

test('every picture below the first screen is lazy, and the first screen ones are not', () => {
  PAGES.forEach((p) => {
    const list = images(read(p));
    assert.ok(list.length > 0, p);
    list.forEach((img) => {
      const first = FIRST_SCREEN.test(img.src);
      // the hero appears again as the video thumbnail further down, which is lazy
      const thumbnail = /Video thumbnail/.test(img.tag);
      if (first && !thumbnail) {
        assert.strictEqual(img.lazy, false, p + ' should load at once: ' + img.tag);
      } else {
        assert.strictEqual(img.lazy, true, p + ' should be lazy: ' + img.tag);
        assert.match(img.tag, /decoding="async"/, p + ': ' + img.tag);
      }
    });
  });
});

test('the home page has 15 lazy pictures: partners, video thumbnail, testimonials, store badges, app screens, footer badges', () => {
  const lazy = images(read('index.html')).filter((i) => i.lazy);
  assert.strictEqual(lazy.length, 4 + 1 + 5 + 2 + 1 + 2);
});

test('width and height keep the shape of the picture file', () => {
  const dims = (rel) => {
    const buf = fs.readFileSync(path.join(root, rel));
    if (rel.endsWith('.png')) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    if (rel.endsWith('.gif')) return [buf.readUInt16LE(6), buf.readUInt16LE(8)];
    return null;
  };
  const html = read('index.html');
  ['partner1.png', 'partner3.png', 'partner4.png', 'app-store.png', 'google-play.png'].forEach((file) => {
    const tag = images(html).find((i) => i.src.endsWith('/' + file));
    const [w, h] = dims('assets/images/' + file);
    assert.ok(Math.abs(Number(tag.width) / Number(tag.height) - w / h) < 0.02, file + ' ' + tag.width + 'x' + tag.height + ' vs ' + w + 'x' + h);
  });
});

test('the analytics script no longer blocks the page, and no other script in <head> is added', () => {
  PAGES.forEach((p) => {
    const html = read(p);
    const head = html.slice(0, html.indexOf('</head>'));
    const scripts = head.match(/<script\b[^>]*>/g) || [];
    assert.ok(scripts.some((s) => /vercel-analytics\.js"\s+defer>/.test(s)), p);
    scripts.forEach((s) => assert.match(s, /\sdefer\b/, p + ': ' + s));
  });
});

test('emergency scripts and controls are not deferred or made lazy', () => {
  const ambulances = read('pages/ambulances.html');
  ['emergency-sos.js', 'main.js', 'session-guard.js', 'location-service.js'].forEach((name) => {
    const tag = ambulances.match(new RegExp('<script[^>]*' + name.replace('.', '\\.') + '[^>]*>'))[0];
    assert.doesNotMatch(tag, /\b(defer|async)\b/, name);
  });
  assert.match(ambulances, /id="relief-emergency-sos-trigger"/);
  assert.match(ambulances, /href="tel:112"/);
});

test('the heavy pictures stay small', () => {
  const budgets = {
    'ambulance-icon.gif': 250 * 1024, // was 1,852,468 bytes
    'logo.jpg': 30 * 1024,            // was 86,833
    'favicon.jpg': 30 * 1024,         // was 127,218
    'ssl-badge.jpg': 20 * 1024,       // was 31,515
    'partner2-badge.jpeg': 30 * 1024, // home copy of partner2.jpeg (169,102), which the blog still uses
    'partner4.png': 60 * 1024         // was 65,316
  };
  Object.keys(budgets).forEach((file) => {
    assert.ok(size('assets/images/' + file) <= budgets[file], file + ' is ' + size('assets/images/' + file) + ' bytes');
  });
});

test('local pictures of the home page add up to less than 800 KB, and the first screen ones to less than 150 KB', () => {
  const local = (list) => [...new Set(list.map((i) => i.src).filter((s) => !/^https?:/.test(s)))]
    .reduce((sum, s) => sum + size(s.replace(/^\.\//, '').replace(/^\.\.\//, '')), 0);
  const list = images(read('index.html'));
  assert.ok(local(list) < 800 * 1024, 'all ' + local(list));
  assert.ok(local(list.filter((i) => !i.lazy)) < 150 * 1024, 'first screen ' + local(list.filter((i) => !i.lazy)));
  // the animated loader picture is used from the stylesheet during the splash
  assert.ok(size('assets/images/ambulance-icon.gif') < 250 * 1024);
});

test('the picture files are still real images of the expected type', () => {
  const magic = { '.gif': 'GIF8', '.png': '\x89PNG', '.jpg': '\xff\xd8\xff', '.jpeg': '\xff\xd8\xff' };
  ['ambulance-icon.gif', 'logo.jpg', 'favicon.jpg', 'ssl-badge.jpg', 'partner2.jpeg', 'partner2-badge.jpeg', 'partner4.png'].forEach((file) => {
    const head = fs.readFileSync(path.join(root, 'assets/images/' + file)).slice(0, 4).toString('latin1');
    assert.ok(head.startsWith(magic[path.extname(file)]), file);
  });
});

// [width, height] of a JPEG, read from its frame header
function jpegSize(file) {
  const buf = fs.readFileSync(path.join(root, file));
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

test('the logo is still big enough for its largest use (170px, doubled for sharp screens)', () => {
  const dims = jpegSize('assets/images/logo.jpg');
  assert.ok(dims && dims[0] >= 340 && dims[1] >= 340, JSON.stringify(dims));
});

test('the blog keeps the full partner2.jpeg (its featured card shows it about 350px wide), only the home badge uses the small copy', () => {
  const full = jpegSize('assets/images/partner2.jpeg');
  assert.ok(full && full[0] >= 700 && full[1] >= 700, 'partner2.jpeg ' + JSON.stringify(full));
  const badge = jpegSize('assets/images/partner2-badge.jpeg');
  assert.ok(badge && badge[0] >= 200 && badge[1] >= 200, 'partner2-badge.jpeg ' + JSON.stringify(badge));
  assert.match(read('pages/blog.html'), /src="\.\.\/assets\/images\/partner2\.jpeg"/);
  assert.doesNotMatch(read('index.html'), /partner2\.jpeg/);
  assert.match(read('index.html'), /partner2-badge\.jpeg/);
});

test('the measuring script and the document exist and agree', () => {
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'measure-page-weight.js')));
  const doc = read('docs/PAGE_WEIGHT.md');
  ['Before', 'After', 'measure-page-weight', 'loading="lazy"', 'defer'].forEach((w) => assert.ok(doc.includes(w), w));
});
