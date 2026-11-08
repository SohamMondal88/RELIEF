# Deployment smoke check

A short, repeatable check to run after RELIEF is deployed (Issue #117). RELIEF is a static site on Vercel, so "the deploy went green" only means Vercel finished copying files. It does not mean the pages a visitor opens are the ones you meant to ship. This page separates the two and says what to write down as evidence.

> RELIEF is a demonstration project. A passing smoke check shows that the deployed files are served. It does not make the site safe for real patients or real emergencies.

## 1. Build success is not live verification

| Question | Answered by |
|---|---|
| Did the deployment finish? | The Vercel dashboard or the GitHub deployment status. Build success only. |
| Is the right commit behind the URL? | Manual: the commit shown for that deployment in Vercel or GitHub. The site has no version endpoint, so the script cannot read it. |
| Do the routes and first-party files answer from the live URL? | `npm run smoke:deploy` (section 3) |
| Do emergency access, hospitals and the changed page actually work in a browser? | The manual list (section 4) |

Only the last two count as live verification. Do not write "verified live" in a pull request or release note on the strength of a green build.

## 2. Preview and production are separate runs

| | Preview | Production |
|---|---|---|
| URL | The preview URL Vercel gives for the pull request or branch. Always passed with `--url`. | `https://relief-gamma.vercel.app` (the live demo link in the README). It is the default for `--env production`. |
| When | Before merging, when the change touches routes, assets, `sw.js` or anything a visitor sees. | After the merge is deployed. |
| Guard | `--env preview` refuses the production host, so a preview run can never be reported as a production run. | `--env production` needs no URL. |

Write the environment next to every result. A preview result says nothing about production and the other way round.

## 3. Run the script

Needs Node 20 or newer. No install step and no dependencies.

```bash
# production, with the commit you expect to be live
npm run smoke:deploy -- --env production --commit 4f2dcb4

# a preview deployment
npm run smoke:deploy -- --env preview --url https://<preview-host> --commit <sha>

# machine readable
npm run smoke:deploy -- --env production --json
```

(`npm run smoke:deploy -- ...` is the same as `node .github/scripts/deploy-smoke-check.js ...`.)

What it does:

1. Requests these routes: `/`, `/pages/firstaid.html`, `/pages/ambulances.html`, `/pages/hospitals.html`, `/pages/doctors.html`, `/pages/appointments.html`, `/pages/dashboard.html`, `/pages/symptoms.html`. Each must answer `200` with an HTML content type and must not redirect to another host.
2. Reads the stylesheets, scripts and images those pages point to on the same site and requests each one (`HEAD`, falling back to `GET`). Each must answer `200` with a matching content type, so a missing script that is answered with an HTML page is caught too. CDN fonts, icons, map tiles and other third-party hosts are not checked.
3. Prints one line per request (status, content type, URL), says which page used a failing asset, and exits `0` only if everything passed (`1` on a failed check, `2` on bad arguments).

What it never prints or sends: anything after `?` or `#` in a URL, cookies, headers or tokens. A `--url` that contains a user name or password is refused. It only sends `GET` and `HEAD` requests and does not submit forms, call the SOS endpoint, ask for location or sign in.

What it cannot tell you:

- Which commit is deployed. `--commit` is only copied into the report as "intended, not verified".
- Whether JavaScript runs, whether SOS works, or whether the page content is right.
- Anything behind a sign-in.

The script's own logic is covered by `tests/deploy-smoke-check.test.js`, which runs it against a local server.

## 4. Manual check in a browser

Open the URL you just tested and tick what you saw. Keep a private window and no real patient data.

- [ ] Home page loads and the navigation links open their pages.
- [ ] SOS: the button opens the confirmation dialog without signing in and without a location prompt first. Cancel it. Do not send a real alert.
- [ ] First aid page lists guides and one guide opens.
- [ ] Hospitals page shows the list or its "could not load" state with Retry. Facilities that are not verified say so.
- [ ] Ambulances and doctors pages open.
- [ ] The page changed by this release shows the new behavior.
- [ ] The browser console shows no red errors from RELIEF's own files.
- [ ] Anything marked as demo still reads as demo, not as live service.

## 5. Record the evidence

Paste this into the pull request, release note or issue. Do not paste tokens, cookies, the Vercel project settings or bypass links for protected previews.

```
Deployment smoke check
Environment: production | preview
URL: https://...
Intended commit: <sha>   Confirmed in: Vercel dashboard | GitHub deployment | not confirmed
Checked at (UTC): 2026-..-..T..:..Z
Script: npm run smoke:deploy -- --env ...   Result: all N requests ok | M failed (list them)
Manual list (section 4): done | partly (say which items were skipped and why)
Not checked: ...
```

If a route or asset fails, say so in the note. Do not re-run until it goes green and report only the green run.

## 6. When it fails

| Symptom | Likely cause |
|---|---|
| A route answers `404` | The file was renamed or not committed, or the preview is for an older commit. Check the commit in Vercel. |
| An asset answers `404`, used by one page | A wrong relative path, or a file added locally but not committed. `python .github/scripts/check-links.py` finds the same problem before deploy. |
| "unexpected content type" on a script or stylesheet | The host answered with an HTML page instead of the file. Treat it as a missing file. |
| "redirected to another host" | A domain or alias is set to forward somewhere else. Check the alias in Vercel. |
| `timed out` or `network error` | Try again once. If it keeps happening, check the Vercel status page and your own connection before blaming the deploy. |
| A preview answers `401` or `403` | Vercel deployment protection is on for that preview. Open it in a browser signed in to Vercel for the manual check, and do not share bypass tokens. |
