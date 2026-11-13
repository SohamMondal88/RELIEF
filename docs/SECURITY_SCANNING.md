# Dependency and secret scanning

Two checks run in `.github/workflows/security.yml` on every pull request, on every push to `main` and once a week (new advisories show up without any code change). They are separate from `ci.yml`, so a red scan does not hide the lint and test results.

| Check | Tool | Fails when |
|---|---|---|
| Secret scan | [gitleaks](https://github.com/gitleaks/gitleaks) 8.18.4 (release binary, sha256 checked in the workflow) with `.gitleaks.toml` | a commit adds something that looks like a credential. A pull request is scanned for the commits it adds, `main` and the weekly run scan the whole history |
| Dependency audit | `npm audit` read by `scripts/audit-check.js` | `package-lock.json` lists an advisory rated high or critical that is not in `scripts/audit-allowlist.json`, or `npm audit` itself could not run |

Run them yourself before you push:

```bash
npm audit --json > /tmp/npm-audit.json; node scripts/audit-check.js /tmp/npm-audit.json
gitleaks detect --source . --config .gitleaks.toml --redact     # needs gitleaks installed
```

## Reading a finding

Both checks write one annotation per finding on the pull request ("Files changed" and the job log).

- Secret scan: rule name, file, line, commit and a fingerprint. The value itself is hidden (`--redact`), because the workflow log of a public repository is public.
- Dependency audit: advisory id (GHSA), severity, package, affected range, the link and the version that fixes it, and whether it is a direct dependency or pulled in by another one.

## A secret was found

Treat it as leaked the moment it is pushed, even if the pull request is closed or the branch is deleted: GitHub keeps commits reachable by hash and others may have copied it.

1. **Revoke or rotate it first** (steps below). Do this before anything else, and before cleaning up git.
2. Remove it from the code. A real value never belongs in a page or script: everything in `assets/` is public. Use the placeholder style the repo already has (`your_api_key`, `YOUR_API_KEY`).
3. Check the provider's usage or audit log for the time between the push and the rotation. If anything looks used by someone else, tell the maintainers privately (see the security note in the README), not in a public issue.
4. Only then, if the value is in history, rewrite it out (`git filter-repo --replace-text`, or delete the branch for an unmerged pull request) and ask GitHub support to drop cached views. Rewriting history does not make a leaked secret safe again, rotating does.
5. If the finding is a false positive, do not rotate; follow "Allow-listing a false positive" below.

### Rotating a credential

The exact screens belong to each provider, so these are the steps, not click paths.

- **Any API key (Google Maps, Infermedica or similar):** create a new key in the provider's console, restrict it (allowed websites and APIs) before using it, switch the deployment to it, then delete the old key. In this repo these keys are still placeholders (`docs/CONTRIBUTING_SETUP.md`), so a real one in a commit is always a mistake.
- **Firebase:** the web `apiKey` in a Firebase config is an identifier, not a secret (`docs/ADMIN_ACCESS.md`, "Secrets"), so finding one is not a leak by itself. A **service account key** or an **Admin SDK** file is a secret: delete that key in the Google Cloud console (IAM and Admin, Service accounts, Keys), create a new one only if a server really needs it, and keep it out of the repository. An **App Check debug token** (`docs/FIREBASE_SECURITY.md`) is deleted in the Firebase console and a new one is created.
- **A GitHub token:** revoke it under Settings, Developer settings, then create a new one with the smallest scope that works.
- **Anything that signs or verifies requests (webhook secret, SOS or backend endpoint credentials):** generate a new value on the server side, deploy it, then invalidate the old one.

## Allow-listing a false positive

Never switch a check off. Excuse the one finding and write down why.

**Secret scan.** Two ways, pick the narrower:

1. One finding: copy its `fingerprint` from the annotation into a new line of `.gitleaksignore` at the repository root.
2. A text that keeps appearing (for example a `localStorage` key name that contains the word KEY): add the exact text to `regexes` under `[allowlist]` in `.gitleaks.toml` with a comment that says what it is. Do not allow-list a folder or a whole rule. The two entries already there are for the `relief_notification_prefs_v1` storage key.

**Dependency audit.** Add one entry to `scripts/audit-allowlist.json`:

```json
{ "allow": [
  { "id": "GHSA-xxxx-xxxx-xxxx", "reason": "dev tool only, the vulnerable code path is the CLI flag we never pass", "expires": "2027-03-31" }
] }
```

An entry needs the advisory id, a reason and an expiry date. After the date it stops working and the check fails again, so a decision gets looked at again. Pick a date at most a few months away. Everything else at high or above still fails.

To fix instead of excuse: `npm audit fix` for a fix inside the allowed range, otherwise bump the package, or use `overrides` in `package.json` to force a patched version of a transitive dependency, and run `npm test` and `npm run test:e2e` after.

## Pinned dependencies

- `package.json` uses exact versions (no `^`), and `package-lock.json` is what CI installs with `npm ci`. Upgrades come in as pull requests, so each one is reviewed and tested.
- `.github/dependabot.yml` opens a weekly pull request per out-of-date npm package and GitHub Action (at most 5 of each at a time). GitHub Actions in the workflows are pinned to a major version tag; Dependabot proposes the bumps.
- The gitleaks version and its sha256 are written in `security.yml`, so a changed download fails the job instead of running.

## Maintainer setup (repository settings)

These need repository admin rights and cannot be done from a pull request:

1. Settings, Code security: turn on **Dependabot alerts** and **Dependabot security updates**. They are free for public repositories and add alerts and automatic fix pull requests next to the weekly version updates above.
2. Same page: turn on **Secret scanning** and **Push protection**. GitHub then blocks a push that contains a known provider token before it lands, which the gitleaks job (that only runs after a push) cannot do.
3. Settings, Branches: mark **Secret scan (gitleaks)** and **Dependency audit (npm audit)** as required status checks, together with the checks from `ci.yml`, so a red scan blocks the merge.

## What these checks do not cover

- gitleaks matches patterns. A secret with no recognisable shape (a made-up password in a string) can pass, and a harmless string can look like one. It is a safety net, not a review.
- `npm audit` only knows published advisories for what is in `package-lock.json`. Scripts loaded from a CDN in the pages (Leaflet, Font Awesome) are not covered. Their versions are pinned with integrity hashes (`docs/SECURITY_HEADERS.md`).
- The workflow has been checked with `actionlint` and the scripts run locally, but it has not run on GitHub's runners until the first pull request that contains it.
