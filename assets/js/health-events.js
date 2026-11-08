/**
 * The shared rules for the health-events feature: camps, vaccination drives,
 * screenings, and outreach programmes.
 *
 * We deliberately use one event shape for both published listings and organiser
 * submissions. A new submission always begins as `pending`, even if a browser
 * tries to send a different status. It becomes `confirmed` only after a moderator
 * records a decision and supporting evidence. Rejected items never reach the
 * public list.
 *
 * The form collects dates as DD-MM-YYYY and times as 24-hour HH:MM, in IST. We
 * store complete ISO timestamps with the +05:30 offset so an event means the same
 * thing on every device, regardless of the visitor's local timezone.
 *
 */
(function (root, factory) {
  if (typeof exports === "object" && typeof module !== "undefined") {
    module.exports = factory();
  } else {
    root.HealthEvents = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEMO_QUEUE_KEY = "relief_demo_health_events";
  var SUBMISSION_LOG_KEY = "relief_health_event_submissions";

  var IST_OFFSET = "+05:30";
  var MINUTE = 60 * 1000;
  var HOUR = 60 * MINUTE;
  var DAY = 24 * HOUR;

  var STATUSES = ["pending", "confirmed", "rejected"];

  var TYPES = {
    "health-camp": "Health camp",
    vaccination: "Vaccination drive",
    screening: "Screening event",
    outreach: "Outreach programme",
  };

  var LIMITS = {
    minTitle: 5,
    maxTitle: 120,
    minPlace: 2,
    maxPlace: 80,
    minVenue: 5,
    maxVenue: 200,
    minOrganiser: 3,
    maxOrganiser: 120,
    maxServices: 12,
    maxServiceLength: 60,
    minEligibility: 3,
    maxEligibility: 300,
    maxEmail: 100,
    maxSourceUrl: 300,
    maxActor: 60,
    maxNote: 500,
    minReason: 5,
    minEvidence: 10,
    maxDurationMs: 30 * DAY,
    maxLeadMs: 365 * DAY,
    minIntervalMs: 30 * 1000,
    maxPerDay: 5,
    duplicateWindowMs: 7 * DAY,
    maxDemoPending: 100,
  };

  // Some older records may not have an end time. Rather than leave them visible
  // forever, treat them as finished eight hours after they start.
  var DEFAULT_DURATION_MS = 8 * HOUR;

  function sanitizeText(value, max) {
    var text = String(value === null || value === undefined ? "" : value)
      .replace(
        /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g,
        " ",
      )
      .replace(/<\/?[a-zA-Z!][^>]*>/g, " ")
      .replace(/[<>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (typeof max === "number" && text.length > max)
      text = text.slice(0, max).trim();
    return text;
  }

  function parseServices(value) {
    var parts = Array.isArray(value)
      ? value
      : String(value === null || value === undefined ? "" : value).split(
          /[,;\n]/,
        );
    var seen = {};
    var out = [];
    parts.forEach(function (part) {
      var item = sanitizeText(part, LIMITS.maxServiceLength);
      var key = item.toLowerCase();
      if (item && !seen[key]) {
        seen[key] = true;
        out.push(item);
      }
    });
    return out;
  }

  function digitCount(text) {
    return (String(text).match(/\d/g) || []).length;
  }

  function isPhone(text) {
    return (
      /^[+\d][\d\s\-().]*$/.test(text) &&
      digitCount(text) >= 7 &&
      digitCount(text) <= 15
    );
  }

  function isEmail(text) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  }

  function cleanSourceUrl(raw) {
    var text = sanitizeText(raw, LIMITS.maxSourceUrl + 1);
    if (!text) return { value: "" };
    if (text.length > LIMITS.maxSourceUrl)
      return { error: "The link is too long." };
    var url;
    try {
      url = new URL(text);
    } catch (e) {
      return {
        error: "Enter a full web address starting with http:// or https://.",
      };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return {
        error: "Enter a full web address starting with http:// or https://.",
      };
    if (url.username || url.password)
      return { error: "Remove the user name or password from the link." };
    if (url.hostname.indexOf(".") === -1)
      return { error: "That web address does not look right." };
    return { value: url.href };
  }

  // ---- dates and times ----------------------------------------------------

  // Check the actual calendar for a year, month and day, so entries such as
  // 31 April are rejected instead of being rolled into the next month.
  function isRealCalendarDay(y, mo, d) {
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false;
    var days = [
      31,
      (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ];
    return d <= days[mo - 1];
  }

  // The form and filters use DD-MM-YYYY.
  function isValidDate(text) {
    var m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(text || ""));
    if (!m) return false;
    return isRealCalendarDay(Number(m[3]), Number(m[2]), Number(m[1]));
  }

  // Stored timestamps use YYYY-MM-DD inside the ISO string.
  function isValidIsoDate(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ""));
    if (!m) return false;
    return isRealCalendarDay(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  // DD-MM-YYYY to YYYY-MM-DD, or null when it is not a real date.
  function toIsoDate(text) {
    if (!isValidDate(text)) return null;
    var m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(text));
    return m[3] + "-" + m[2] + "-" + m[1];
  }

  // The form uses a 24-hour clock to avoid AM/PM ambiguity.
  function isValidTime(text) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(text || ""));
  }

  // Combine form values (DD-MM-YYYY and HH:MM) into an IST timestamp. Keeping the
  // offset avoids relying on whichever timezone is set on the reader's device.
  function toIstIso(date, time) {
    var iso = toIsoDate(date);
    if (!iso || !isValidTime(time)) return null;
    return iso + "T" + time + ":00" + IST_OFFSET;
  }

  // A timezone-free timestamp is ambiguous. Accept only complete ISO values with
  // an explicit offset (or Z) so records keep their original meaning.
  function parseInstant(value) {
    if (typeof value !== "string") return NaN;
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
        value,
      )
    )
      return NaN;
    if (!isValidIsoDate(value.slice(0, 10))) return NaN;
    return Date.parse(value);
  }

  // Filters are calendar-based, so calculate their boundaries in IST rather than
  // in the browser's local timezone. Takes a DD-MM-YYYY date.
  function istDayStart(date) {
    var iso = toIsoDate(date);
    return iso ? Date.parse(iso + "T00:00:00" + IST_OFFSET) : NaN;
  }

  // This is used for comparisons, not display. Shifting before slicing gives the
  // calendar day a person in India would recognise. Returns YYYY-MM-DD.
  function istDate(ms) {
    var shifted = new Date(ms + 330 * MINUTE);
    return shifted.toISOString().slice(0, 10);
  }

  function endOf(event) {
    var end = parseInstant(event && event.endsAt);
    if (isFinite(end)) return end;
    var start = parseInstant(event && event.startsAt);
    return isFinite(start) ? start + DEFAULT_DURATION_MS : NaN;
  }

  // Events move to the archive only after their end time has passed. When an end
  // is missing, endOf() applies the conservative eight-hour fallback above.
  function timeState(event, now) {
    var t = typeof now === "number" ? now : Date.now();
    var start = parseInstant(event && event.startsAt);
    var end = endOf(event);
    if (!isFinite(start)) return "past";
    if (end <= t) return "past";
    if (start <= t) return "ongoing";
    return "upcoming";
  }

  // ---- records ------------------------------------------------------------

  function copyRecord(record) {
    return Object.assign({}, record, {
      services: Array.isArray(record.services) ? record.services.slice() : [],
      history: Array.isArray(record.history)
        ? record.history.map(function (h) {
            return Object.assign({}, h);
          })
        : [],
    });
  }

  /**
   * Bring data from the file, backend, or demo queue into one safe shape.
   * Bad dates and incomplete records are dropped rather than guessed at. We also
   * treat anything other than the exact `confirmed` value as unverified. That
   * conservative default stops a typo or unfamiliar backend status from making an
   * event look checked when it has not been done so.
   */
  function normalizeEvent(raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = sanitizeText(raw.id, 80);
    var title = sanitizeText(raw.title, LIMITS.maxTitle);
    var start = parseInstant(raw.startsAt);
    if (!id || !title || !isFinite(start)) return null;
    var end = parseInstant(raw.endsAt);
    if (raw.endsAt !== undefined && raw.endsAt !== null && raw.endsAt !== "") {
      if (!isFinite(end) || end <= start) return null;
    }
    var status =
      raw.status === "confirmed" || raw.status === "rejected"
        ? raw.status
        : "pending";
    var updated = parseInstant(raw.lastUpdated);
    var phone = sanitizeText(raw.contactPhone, 30);
    var email = sanitizeText(raw.contactEmail, LIMITS.maxEmail);
    var source = cleanSourceUrl(raw.sourceUrl);
    return {
      id: id,
      title: title,
      type: Object.prototype.hasOwnProperty.call(TYPES, raw.type)
        ? raw.type
        : "outreach",
      startsAt: raw.startsAt,
      endsAt: isFinite(end) ? raw.endsAt : null,
      district: sanitizeText(raw.district, LIMITS.maxPlace),
      venue: sanitizeText(raw.venue, LIMITS.maxVenue),
      organiser: sanitizeText(raw.organiser, LIMITS.maxOrganiser),
      services: parseServices(raw.services).slice(0, LIMITS.maxServices),
      eligibility: sanitizeText(raw.eligibility, LIMITS.maxEligibility),
      contactPhone: phone && isPhone(phone) ? phone : "",
      contactEmail: email && isEmail(email) ? email : "",
      sourceUrl: source.value || "",
      status: status,
      lastUpdated: isFinite(updated) ? raw.lastUpdated : null,
      verifiedBy:
        status === "confirmed"
          ? sanitizeText(raw.verifiedBy, LIMITS.maxActor) || null
          : null,
      sample: raw.sample === true,
      demo: raw.demo === true,
    };
  }

  function normalizeEvents(list) {
    var seen = {};
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      var e = normalizeEvent(raw);
      if (e && !seen[e.id]) {
        seen[e.id] = true;
        out.push(e);
      }
    });
    return out;
  }

  function isConfirmed(event) {
    return !!event && event.status === "confirmed";
  }

  // ---- filtering ----------------------------------------------------------

  /**
   * Validate filter dates (DD-MM-YYYY) before filtering. The end of the selected
   * `to` date is included, which is what people normally expect when they search
   * for an event happening on that day.
   */
  function validateFilters(filters) {
    var f = filters || {};
    var errors = {};
    var fromMs = null;
    var toMs = null;
    if (f.from) {
      if (!isValidDate(f.from))
        errors.from = 'Enter a valid "from" date, for example 14-11-2026.';
      else fromMs = istDayStart(f.from);
    }
    if (f.to) {
      if (!isValidDate(f.to))
        errors.to = 'Enter a valid "to" date, for example 14-11-2026.';
      else toMs = istDayStart(f.to) + DAY;
    }
    if (fromMs !== null && toMs !== null && toMs <= fromMs) {
      errors.to = 'The "to" date must be on or after the "from" date.';
    }
    return {
      valid: Object.keys(errors).length === 0,
      errors: errors,
      fromMs: fromMs,
      toMs: toMs,
    };
  }

  function lower(text) {
    return String(text || "").toLowerCase();
  }

  /**
   * Filter by location, type, and a date range. Multi-day events are included
   * whenever they overlap the requested dates, not only when they start there.
   * Rejected records are never visible. Pending records require an explicit
   * opt-in, so the default list remains a list of confirmed information.
   */
  function filterEvents(events, filters) {
    var f = filters || {};
    var range = validateFilters(f);
    var location = lower(sanitizeText(f.location, LIMITS.maxPlace));
    var type = Object.prototype.hasOwnProperty.call(TYPES, f.type)
      ? f.type
      : "";
    return (Array.isArray(events) ? events : []).filter(function (e) {
      if (!e || e.status === "rejected") return false;
      if (!isConfirmed(e) && f.includeUnverified !== true) return false;
      if (type && e.type !== type) return false;
      if (location) {
        var haystack =
          lower(e.district) + " " + lower(e.venue) + " " + lower(e.title);
        if (haystack.indexOf(location) === -1) return false;
      }
      if (range.valid) {
        var start = parseInstant(e.startsAt);
        var end = endOf(e);
        if (range.fromMs !== null && end <= range.fromMs) return false;
        if (range.toMs !== null && start >= range.toMs) return false;
      }
      return true;
    });
  }

  // The page presents useful events first and keeps ended ones in an archive.
  // Sorting each group separately makes the next event easy to find while keeping
  // the most recently finished event at the top of the archive.
  function partitionByTime(events, now) {
    var t = typeof now === "number" ? now : Date.now();
    var current = [];
    var past = [];
    (Array.isArray(events) ? events : []).forEach(function (e) {
      (timeState(e, t) === "past" ? past : current).push(e);
    });
    current.sort(function (a, b) {
      return parseInstant(a.startsAt) - parseInstant(b.startsAt);
    });
    past.sort(function (a, b) {
      return endOf(b) - endOf(a);
    });
    return { current: current, past: past };
  }

  function districts(events) {
    var seen = {};
    var out = [];
    (Array.isArray(events) ? events : []).forEach(function (e) {
      var name = e && e.district;
      if (name && !seen[name.toLowerCase()]) {
        seen[name.toLowerCase()] = true;
        out.push(name);
      }
    });
    return out.sort();
  }

  // ---- organiser submissions ----------------------------------------------

  /**
   * Validate and clean an organiser submission before it is sent or queued.
   * Dates are DD-MM-YYYY and times are HH:MM, both in IST.
   * `website` is a hidden honeypot: genuine visitors should never fill it in.
   * Status and verification fields are deliberately ignored here. A form may
   * suggest an event, but it cannot grant itself moderator authority.
   */
  function validateSubmission(input, ctx) {
    var data = input || {};
    var now = ctx && typeof ctx.now === "number" ? ctx.now : Date.now();
    var errors = {};
    var clean = {};

    if (
      data.website !== undefined &&
      data.website !== null &&
      String(data.website).trim() !== ""
    ) {
      return {
        valid: false,
        errors: { form: "This could not be submitted." },
        clean: {},
        spam: true,
      };
    }

    var title = sanitizeText(data.title);
    if (title.length < LIMITS.minTitle)
      errors.title =
        "Enter the event name (at least " + LIMITS.minTitle + " characters).";
    else if (title.length > LIMITS.maxTitle)
      errors.title =
        "Keep the event name under " + LIMITS.maxTitle + " characters.";
    else clean.title = title;

    if (!Object.prototype.hasOwnProperty.call(TYPES, data.type))
      errors.type = "Choose the kind of event.";
    else clean.type = data.type;

    // An omitted end date means the event ends on its start date.
    var startDate = String(data.startDate || "").trim();
    var startTime = String(data.startTime || "").trim();
    var rawEndDate = String(data.endDate || "").trim();
    var endDate = rawEndDate || startDate;
    var endTime = String(data.endTime || "").trim();
    if (!startDate) errors.startDate = "Enter the date of the event.";
    else if (!isValidDate(startDate))
      errors.startDate = "Enter a real date, for example 14-11-2026.";
    if (!startTime) errors.startTime = "Enter the start time.";
    else if (!isValidTime(startTime))
      errors.startTime =
        "Enter the start time as hours and minutes, for example 09:30.";
    if (rawEndDate && !isValidDate(rawEndDate))
      errors.endDate =
        "Enter a real end date, for example 16-11-2026, or leave it empty for a one day event.";
    if (!endTime) errors.endTime = "Enter the end time.";
    else if (!isValidTime(endTime))
      errors.endTime =
        "Enter the end time as hours and minutes, for example 16:00.";

    var startsAt = toIstIso(startDate, startTime);
    var endsAt = toIstIso(endDate, endTime);
    if (startsAt && !errors.startDate && !errors.startTime) {
      var start = Date.parse(startsAt);
      if (start <= now)
        errors.startDate = "The event must start in the future.";
      else if (start - now > LIMITS.maxLeadMs)
        errors.startDate = "Events can be listed up to one year ahead.";
      else clean.startsAt = startsAt;
    }
    if (clean.startsAt && endsAt && !errors.endDate && !errors.endTime) {
      var duration = Date.parse(endsAt) - Date.parse(clean.startsAt);
      if (duration <= 0) errors.endTime = "The event must end after it starts.";
      else if (duration > LIMITS.maxDurationMs)
        errors.endDate =
          "An event can last at most 30 days. Submit longer programmes as separate events.";
      else clean.endsAt = endsAt;
    }

    var district = sanitizeText(data.district);
    if (district.length < LIMITS.minPlace)
      errors.district = "Enter the district or block.";
    else if (district.length > LIMITS.maxPlace)
      errors.district =
        "Keep the district under " + LIMITS.maxPlace + " characters.";
    else clean.district = district;

    var venue = sanitizeText(data.venue);
    if (venue.length < LIMITS.minVenue)
      errors.venue =
        "Enter the venue: village, landmark or building (at least " +
        LIMITS.minVenue +
        " characters).";
    else if (venue.length > LIMITS.maxVenue)
      errors.venue = "Keep the venue under " + LIMITS.maxVenue + " characters.";
    else clean.venue = venue;

    var organiser = sanitizeText(data.organiser);
    if (organiser.length < LIMITS.minOrganiser)
      errors.organiser = "Enter who is running the event.";
    else if (organiser.length > LIMITS.maxOrganiser)
      errors.organiser =
        "Keep the organiser name under " + LIMITS.maxOrganiser + " characters.";
    else clean.organiser = organiser;

    var services = parseServices(data.services);
    if (services.length === 0)
      errors.services =
        "List at least one service. Separate several with commas.";
    else if (services.length > LIMITS.maxServices)
      errors.services = "List at most " + LIMITS.maxServices + " services.";
    else clean.services = services;

    var eligibility = sanitizeText(data.eligibility);
    if (eligibility.length < LIMITS.minEligibility)
      errors.eligibility =
        'Say who can attend, for example "Everyone" or "Children under 5".';
    else if (eligibility.length > LIMITS.maxEligibility)
      errors.eligibility =
        "Keep eligibility under " + LIMITS.maxEligibility + " characters.";
    else clean.eligibility = eligibility;

    var phone = sanitizeText(data.contactPhone, 31);
    var email = sanitizeText(data.contactEmail, LIMITS.maxEmail + 1);
    if (phone && !isPhone(phone))
      errors.contactPhone =
        "Enter a phone number using digits, spaces, +, - and brackets (7 to 15 digits).";
    if (email && (email.length > LIMITS.maxEmail || !isEmail(email)))
      errors.contactEmail = "Enter a valid email address.";
    if (!phone && !email)
      errors.contactPhone =
        "Give a phone number or email so people can check before travelling.";
    if (!errors.contactPhone) clean.contactPhone = phone;
    if (!errors.contactEmail) clean.contactEmail = email;

    var source = cleanSourceUrl(data.sourceUrl);
    if (source.error) errors.sourceUrl = source.error;
    else clean.sourceUrl = source.value;

    return {
      valid: Object.keys(errors).length === 0,
      errors: errors,
      clean: clean,
    };
  }

  // This is intentionally simple: it catches common double submissions without
  // trying to claim that two similarly named real-world events are impossible.
  function fingerprint(clean) {
    return [
      lower(clean.title).replace(/\s+/g, " "),
      clean.startsAt,
      lower(clean.district),
    ].join("::");
  }

  /**
   * This browser-side check stops accidental double-clicks and obvious loops.
   * It is only a courtesy guard: the production service must repeat these checks
   * server-side because localStorage can be cleared or bypassed.
   */
  function checkRateLimit(log, now, clean, limits) {
    var lim = Object.assign({}, LIMITS, limits || {});
    var entries = (Array.isArray(log) ? log : []).filter(function (e) {
      return (
        e && typeof e.at === "number" && isFinite(e.at) && e.at <= now + MINUTE
      );
    });
    var fp = clean ? fingerprint(clean) : null;
    if (
      fp &&
      entries.some(function (e) {
        return e.fingerprint === fp && now - e.at < lim.duplicateWindowMs;
      })
    ) {
      return {
        allowed: false,
        reason: "duplicate",
        message: "You already submitted this event. A moderator will check it.",
      };
    }
    var last = entries.reduce(function (max, e) {
      return Math.max(max, e.at);
    }, 0);
    if (last && now - last < lim.minIntervalMs) {
      return {
        allowed: false,
        reason: "too-fast",
        message: "Please wait a few seconds before submitting another event.",
      };
    }
    if (
      entries.filter(function (e) {
        return now - e.at < DAY;
      }).length >= lim.maxPerDay
    ) {
      return {
        allowed: false,
        reason: "daily",
        message: "That is the limit for today. Please try again tomorrow.",
      };
    }
    return { allowed: true, reason: null, message: "" };
  }

  // Build the immutable starting point for moderation. A submission is always
  // pending; this is the key rule that keeps self-submitted events from appearing
  // as confirmed listings.
  function buildSubmission(clean, ctx) {
    var c = ctx || {};
    var now = typeof c.now === "number" ? c.now : Date.now();
    var at = new Date(now).toISOString();
    return {
      id:
        c.id ||
        "evt_" +
          now.toString(36) +
          "_" +
          Math.random().toString(36).slice(2, 8),
      title: clean.title,
      type: clean.type,
      startsAt: clean.startsAt,
      endsAt: clean.endsAt,
      district: clean.district,
      venue: clean.venue,
      organiser: clean.organiser,
      services: clean.services.slice(),
      eligibility: clean.eligibility,
      contactPhone: clean.contactPhone || "",
      contactEmail: clean.contactEmail || "",
      sourceUrl: clean.sourceUrl || "",
      status: "pending",
      createdAt: at,
      lastUpdated: at,
      decidedAt: null,
      verifiedBy: null,
      decisionReason: null,
      evidence: null,
      history: [
        {
          seq: 1,
          at: at,
          action: "submitted",
          by: "organiser",
          note: "",
          evidence: "",
        },
      ],
    };
  }

  // ---- moderation ---------------------------------------------------------

  /**
   * Apply the one allowed status transition. Decisions are final so the history
   * stays trustworthy: a moderator must be named, approvals need evidence of a
   * check, and rejections need a reason. This returns a copy instead of mutating
   * the original record, which keeps callers from accidentally changing history.
   */
  function decide(record, decision, ctx) {
    var d = decision || {};
    var errors = {};
    if (
      !record ||
      typeof record !== "object" ||
      STATUSES.indexOf(record.status) === -1
    ) {
      return {
        ok: false,
        record: null,
        errors: { form: "That submission could not be found." },
      };
    }
    if (record.status !== "pending") {
      return {
        ok: false,
        record: null,
        errors: {
          form:
            "This submission was already " +
            record.status +
            ". A decision cannot be changed.",
        },
      };
    }
    var kind = d.decision;
    if (kind !== "approve" && kind !== "reject")
      errors.decision = "Choose approve or reject.";
    var actor = sanitizeText(d.actor, LIMITS.maxActor);
    if (actor.length < 2)
      errors.actor = "Enter your name so the decision is logged.";
    var reason = sanitizeText(d.reason, LIMITS.maxNote);
    var evidence = sanitizeText(d.evidence, LIMITS.maxNote);
    if (kind === "approve" && evidence.length < LIMITS.minEvidence) {
      errors.evidence =
        "Confirming needs evidence: say how you checked the event with the organiser (at least " +
        LIMITS.minEvidence +
        " characters).";
    }
    if (kind === "reject" && reason.length < LIMITS.minReason) {
      errors.reason =
        "Rejecting needs a reason (at least " +
        LIMITS.minReason +
        " characters).";
    }
    if (Object.keys(errors).length)
      return { ok: false, record: null, errors: errors };

    var c = ctx || {};
    var now = typeof c.now === "number" ? c.now : Date.now();
    var at = new Date(now).toISOString();
    var next = copyRecord(record);
    var action = kind === "approve" ? "confirmed" : "rejected";
    next.status = action;
    next.decidedAt = at;
    next.lastUpdated = at;
    next.verifiedBy = kind === "approve" ? actor : null;
    next.decisionReason = reason || null;
    next.evidence = evidence || null;
    next.history.push({
      seq: next.history.length + 1,
      at: at,
      action: action,
      by: actor,
      note: reason,
      evidence: evidence,
    });
    return { ok: true, record: next, errors: {} };
  }

  // ---- store --------------------------------------------------------------

  var UNAVAILABLE_MESSAGE =
    "Events cannot be sent right now because the review service is not reachable. Please try again later.";

  function readJson(storage, key, fallback) {
    try {
      var parsed = JSON.parse(storage.getItem(key));
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Keep external dependencies at the edge of the feature. This lets the same
   * store work with a real API in production, localStorage during a demo, and
   * small fake dependencies in tests. Methods return result objects rather than
   * leaking rejected promises into the UI.
   */
  function createStore(deps) {
    var d = deps || {};
    var api = d.api || null;
    var storage = d.storage || null;
    var demo = d.demo === true;
    var clock =
      typeof d.now === "function"
        ? d.now
        : function () {
            return Date.now();
          };

    function hasApi(method) {
      return !!(api && typeof api[method] === "function");
    }

    function readQueue() {
      var data = storage ? readJson(storage, DEMO_QUEUE_KEY, []) : [];
      return Array.isArray(data)
        ? data.filter(function (r) {
            return r && STATUSES.indexOf(r.status) !== -1;
          })
        : [];
    }

    function writeQueue(items) {
      return !!storage && writeJson(storage, DEMO_QUEUE_KEY, items);
    }

    function readLog() {
      var data = storage ? readJson(storage, SUBMISSION_LOG_KEY, []) : [];
      return Array.isArray(data) ? data : [];
    }

    function writeLog(entries) {
      var cutoff = clock() - LIMITS.duplicateWindowMs;
      return (
        !!storage &&
        writeJson(
          storage,
          SUBMISSION_LOG_KEY,
          entries
            .filter(function (e) {
              return e && e.at > cutoff;
            })
            .slice(-50),
        )
      );
    }

    function unavailable() {
      return {
        ok: false,
        kind: "unavailable",
        message: UNAVAILABLE_MESSAGE,
        errors: {},
      };
    }

    function moderatorOnly(error) {
      return (
        error &&
        (error.code === "unauthenticated" || error.code === "forbidden")
      );
    }

    /**
     * Prefer the live public list, but keep the checked-in data file as a useful
     * fallback when the review service is unavailable. Demo records are included
     * only in demo mode, and rejected records stay out in every mode.
     */
    async function publicEvents(seed) {
      if (hasApi("listHealthEvents")) {
        try {
          var answer = await api.listHealthEvents();
          var rows = Array.isArray(answer)
            ? answer
            : answer && Array.isArray(answer.events)
              ? answer.events
              : null;
          if (rows)
            return {
              ok: true,
              mode: "server",
              demo: false,
              events: normalizeEvents(rows),
            };
        } catch (error) {
          // A directory is still more useful with the reviewed fallback data.
        }
      }
      var list = Array.isArray(seed) ? seed.slice() : [];
      if (demo) {
        readQueue().forEach(function (r) {
          if (r.status !== "rejected")
            list.push(Object.assign({}, r, { demo: true }));
        });
      }
      return {
        ok: true,
        mode: demo ? "demo" : "static",
        demo: demo,
        events: normalizeEvents(list),
      };
    }

    async function submit(input) {
      var now = clock();
      var checked = validateSubmission(input, { now: now });
      if (checked.spam)
        return {
          ok: false,
          kind: "spam",
          message: checked.errors.form,
          errors: checked.errors,
        };
      if (!checked.valid)
        return {
          ok: false,
          kind: "invalid",
          message: "Please fix the highlighted fields.",
          errors: checked.errors,
        };

      var limit = checkRateLimit(readLog(), now, checked.clean, d.limits);
      if (!limit.allowed) {
        return {
          ok: false,
          kind: limit.reason === "duplicate" ? "duplicate" : "rate-limited",
          message: limit.message,
          errors: {},
        };
      }

      var done = function (mode, submission) {
        var log = readLog();
        log.push({ at: now, fingerprint: fingerprint(checked.clean) });
        writeLog(log);
        return {
          ok: true,
          mode: mode,
          demo: mode === "demo",
          submission: submission,
        };
      };

      if (hasApi("submitHealthEvent")) {
        try {
          // Send only validated event details. The server, not this page, sets status.
          var answer = await api.submitHealthEvent(
            Object.assign({}, checked.clean),
          );
          return done("server", answer);
        } catch (error) {
          if (error && error.code === "rate-limited") {
            return {
              ok: false,
              kind: "rate-limited",
              message: "Too many submissions. Please try again later.",
              errors: {},
            };
          }
          if (error && error.code === "rejected") {
            return {
              ok: false,
              kind: "invalid",
              message: "The review service did not accept this event.",
              errors: (error.details && error.details.errors) || {},
            };
          }
          if (!demo) return unavailable();
        }
      } else if (!demo) {
        return unavailable();
      }

      var queue = readQueue();
      var pending = queue.filter(function (r) {
        return r.status === "pending";
      });
      var fp = fingerprint(checked.clean);
      if (
        pending.some(function (r) {
          return fingerprint(r) === fp;
        })
      ) {
        return {
          ok: false,
          kind: "duplicate",
          message: "This event is already waiting for review.",
          errors: {},
        };
      }
      if (pending.length >= LIMITS.maxDemoPending) {
        return {
          ok: false,
          kind: "queue-full",
          message: "The demo review queue is full.",
          errors: {},
        };
      }
      var submission = buildSubmission(checked.clean, {
        now: now,
        id: typeof d.idFn === "function" ? d.idFn() : undefined,
      });
      submission.demo = true;
      queue.push(submission);
      if (!writeQueue(queue)) {
        return {
          ok: false,
          kind: "storage",
          message:
            "Browser storage is unavailable, so the demo submission could not be saved.",
          errors: {},
        };
      }
      return done("demo", submission);
    }

    // The server enforces who may see this queue; demo mode reads its own local queue.
    async function list(filter) {
      var status =
        filter && filter.status && filter.status !== "all"
          ? filter.status
          : null;
      if (hasApi("listHealthEventSubmissions")) {
        try {
          var answer = await api.listHealthEventSubmissions(
            status ? { status: status } : {},
          );
          var rows = Array.isArray(answer)
            ? answer
            : answer && Array.isArray(answer.submissions)
              ? answer.submissions
              : null;
          if (rows)
            return {
              ok: true,
              mode: "server",
              demo: false,
              items: rows.filter(function (r) {
                return r && STATUSES.indexOf(r.status) !== -1;
              }),
            };
        } catch (error) {
          if (moderatorOnly(error))
            return {
              ok: false,
              kind: error.code,
              message: "You need a moderator account to review events.",
              errors: {},
            };
        }
        if (!demo) return unavailable();
      } else if (!demo) {
        return unavailable();
      }
      var all = readQueue();
      return {
        ok: true,
        mode: "demo",
        demo: true,
        items: status
          ? all.filter(function (r) {
              return r.status === status;
            })
          : all,
      };
    }

    // Review one submission. The real server derives the moderator identity from
    // their login rather than trusting a name supplied by the browser.
    async function review(id, decision) {
      var dec = decision || {};
      if (hasApi("reviewHealthEventSubmission")) {
        var pre = decide({ status: "pending" }, dec, { now: clock() });
        if (
          !pre.ok &&
          (pre.errors.decision || pre.errors.evidence || pre.errors.reason)
        ) {
          return {
            ok: false,
            kind: "invalid",
            message: "Please fix the highlighted fields.",
            errors: pre.errors,
          };
        }
        try {
          // Do not send the display-name field here; the backend owns that audit trail.
          var answer = await api.reviewHealthEventSubmission(id, {
            decision: dec.decision,
            reason: sanitizeText(dec.reason, LIMITS.maxNote),
            evidence: sanitizeText(dec.evidence, LIMITS.maxNote),
          });
          return { ok: true, mode: "server", demo: false, submission: answer };
        } catch (error) {
          if (moderatorOnly(error))
            return {
              ok: false,
              kind: error.code,
              message: "You need a moderator account to review events.",
              errors: {},
            };
          if (error && error.code === "rejected") {
            return {
              ok: false,
              kind: "invalid",
              message: "The review service did not accept this decision.",
              errors: (error.details && error.details.errors) || {},
            };
          }
          if (!demo) return unavailable();
        }
      } else if (!demo) {
        return unavailable();
      }

      var queue = readQueue();
      var index = -1;
      for (var i = 0; i < queue.length; i++) {
        if (queue[i].id === id) {
          index = i;
          break;
        }
      }
      if (index === -1)
        return {
          ok: false,
          kind: "not-found",
          message: "That submission could not be found.",
          errors: {},
        };
      var result = decide(queue[index], dec, { now: clock() });
      if (!result.ok) {
        return {
          ok: false,
          kind: result.errors.form ? "final" : "invalid",
          message: result.errors.form || "Please fix the highlighted fields.",
          errors: result.errors,
        };
      }
      queue[index] = result.record;
      if (!writeQueue(queue))
        return {
          ok: false,
          kind: "storage",
          message:
            "Browser storage is unavailable, so the decision could not be saved.",
          errors: {},
        };
      return { ok: true, mode: "demo", demo: true, submission: result.record };
    }

    return {
      publicEvents: publicEvents,
      submit: submit,
      list: list,
      review: review,
    };
  }

  return {
    DEMO_QUEUE_KEY: DEMO_QUEUE_KEY,
    SUBMISSION_LOG_KEY: SUBMISSION_LOG_KEY,
    STATUSES: STATUSES.slice(),
    TYPES: TYPES,
    LIMITS: LIMITS,
    UNAVAILABLE_MESSAGE: UNAVAILABLE_MESSAGE,
    sanitizeText: sanitizeText,
    parseServices: parseServices,
    isValidDate: isValidDate,
    isValidTime: isValidTime,
    toIstIso: toIstIso,
    parseInstant: parseInstant,
    istDate: istDate,
    timeState: timeState,
    normalizeEvent: normalizeEvent,
    normalizeEvents: normalizeEvents,
    isConfirmed: isConfirmed,
    validateFilters: validateFilters,
    filterEvents: filterEvents,
    partitionByTime: partitionByTime,
    districts: districts,
    validateSubmission: validateSubmission,
    fingerprint: fingerprint,
    checkRateLimit: checkRateLimit,
    buildSubmission: buildSubmission,
    decide: decide,
    createStore: createStore,
  };
});
