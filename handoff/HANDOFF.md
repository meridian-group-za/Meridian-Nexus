# Nexus Notifications — handoff notes

This explains the GeoRep notifications feature on Nexus Connect end to end,
in case Carin isn't around to explain it. Read this top to bottom before
touching anything. This file lives at `handoff/HANDOFF.md` in this same
repo — everything it references (`notifications.js`, `scripts/`, `tests/`,
`portal.html`, etc.) is at the repo root alongside it, not duplicated here.

## What this is

A "Notifications" section on the Connect page of the Nexus portal
(`../portal.html`) that shows live cards from GeoRep's ContentFeed. It is
**not** a live API call from the browser to GeoRep — GeoRep has no public
read API. Instead:

1. A script (`../scripts/local-georep-robot.mjs`) runs on **Carin's
   machine** every 15 minutes via Windows Task Scheduler, under her own
   signed-in session.
2. It reads GeoRep's ContentFeed pages using her authenticated browser
   session, downloads any images, and uploads a `notifications.json` +
   image files to a private SharePoint folder:
   `/sites/MeridianNexus/Shared Documents/Connect/Notifications`
3. `../notifications.js` (loaded by `portal.html`) reads that JSON from
   SharePoint via Microsoft Graph, using the signed-in Nexus user's own
   delegated permission — not the robot, not a shared secret.

So there are two independent things that can break: **the robot** (feeds
SharePoint) and **the Graph read** (feeds the portal from SharePoint). They
fail differently and are fixed differently — see Troubleshooting below.

## Relevant files (all at the repo root, not in this folder)

- `notifications.js` — the portal-side module, loaded via
  `<script src="notifications.js">` in `portal.html`.
- `scripts/local-georep-robot.mjs` — the robot itself (login/sync/check
  commands).
- `scripts/sync-georep-notifications.mjs` — shared field-mapping logic
  (`normalizeRecord`) used by the robot.
- `scripts/install-local-georep-robot.ps1` — one-time setup: registers the
  Windows Scheduled Task and runs the first sign-in.
- `SETUP_NOTIFICATION_ROBOT.cmd` — double-click wrapper around the install
  script, for someone who doesn't want to touch PowerShell directly.
- `package.json` / `package-lock.json` — the robot's only dependency is
  `playwright` (drives a real Edge browser to hold GeoRep + SharePoint
  sessions).
- `tests/notifications.test.cjs`, `tests/portal-injection.test.cjs`,
  `tests/sync-georep-notifications.test.mjs` — run with `node tests/<file>`
  (the `.mjs` one needs `node --test`) after `npm install`, to confirm
  nothing's broken before/after a change.
- `LOCAL_NOTIFICATION_ROBOT.md` — the original short setup doc.

In this `handoff/` folder specifically:

- `HANDOFF.md` — this file.
- `ScheduledTask_GeoRep_Notifications.xml` — an exported copy of the actual
  Windows Scheduled Task currently running on Carin's machine, named
  **"Meridian Nexus - GeoRep Notifications"**. Re-import it on a new
  machine with:
  ```powershell
  Register-ScheduledTask -Xml (Get-Content "ScheduledTask_GeoRep_Notifications.xml" | Out-String) -TaskName "Meridian Nexus - GeoRep Notifications"
  ```
  (You'll still need to run `robot:login` once on that machine afterward —
  the task references a browser profile folder that has to exist locally,
  see below. Also note the XML hardcodes this machine's repo path and
  Carin's account SID in `Arguments`/`WorkingDirectory`/`UserId` — realistically,
  running `SETUP_NOTIFICATION_ROBOT.cmd` fresh on the new machine, which
  registers the task itself with the right paths and account, is simpler
  and more reliable than editing this XML by hand. The export here is
  mainly a reference for exactly what settings the working task uses —
  15-minute interval, `IgnoreNew` overlap policy, interactive logon, etc.)

## What must NEVER be committed to this repo (or copied anywhere shared)

The robot's browser profile, at `.georep-robot/browser-profile` in the
repo root, holds **live, active session cookies** for both GeoRep and
SharePoint under Carin's account. It's already excluded via `.gitignore`
(`.georep-robot/`) — keep it that way. Do not ever commit or share it —
anyone with access could act as Carin in both systems. If a new person
takes this over, they run `robot:login` themselves to create their own
fresh profile under their own account; they do not need or want the old
one.

## Setting this up on a new machine

1. Clone this repo somewhere permanent:
   `https://github.com/meridian-group-za/Meridian-Nexus` (branch `main`)
2. Install Node.js (this was built/tested against the Node install at
   `C:\Program Files\nodejs`).
3. From the repo root: `npm install` (pulls in Playwright + downloads its
   browser binaries).
4. Run `SETUP_NOTIFICATION_ROBOT.cmd` (or `npm run robot:install`). This
   opens Edge with two tabs — GeoRep and the SharePoint Notifications
   folder. **Sign into both fully** (watch for real page content loading,
   not just a login form — see the lockfile gotcha below), then **close the
   whole browser window**.
5. Setup registers the Scheduled Task and runs one sync immediately.

## The two Azure AD / SharePoint requirements (portal side, not the robot)

These are **not** about the robot — they're about whether the *portal*
(anyone signed into Nexus) can actually read `notifications.json` back out
of SharePoint via Microsoft Graph:

1. **App registration** `73cf19b5-ae3e-4a6e-995a-c539b75a37c5` (the Nexus
   sign-in app) needs the Microsoft Graph **delegated** permission
   **`Sites.Read.All`**, admin-consented. *(Not `Files.Read` — that scope
   only covers a user's own OneDrive plus items explicitly shared with them
   by name; it does not extend to a SharePoint team site's document library
   reached through normal site membership. This cost real time to diagnose
   — confirmed by testing directly against Microsoft Graph in Graph
   Explorer.)*
2. **The `Connect/Notifications` folder itself** needs to be shared with
   whichever group represents "everyone who should see notifications" (e.g.
   "People in Meridian Group" as a view-only org-wide link, or the site's
   own Members/Visitors groups) — Graph delegated permission only lets a
   user read what they already have SharePoint access to; it grants no new
   access on its own.

If notifications ever come back as "Feed temporarily unavailable" for
*everyone*, check these two first via Azure Portal → App registrations →
API permissions, and SharePoint → the folder → Manage access.

## Troubleshooting

**"GeoRep sign-in is required" in `.georep-robot/logs/robot.log`, repeating
every 15 minutes:**
GeoRep's session appears to expire roughly every ~10 hours in practice.
Run `npm run robot:login` again (see step 4 above). As of the notification
feature added 2026-08-13, you should also get a **Windows tray popup**
automatically the first time this happens — if you're signed into the
machine, you don't have to go check the log proactively.

**Ran `robot:login`, signed in fine, but sync still fails right after:**
This bit us once already. Edge can keep running in the background after
you close its window (a "continue running background apps" setting), which
holds a lock on the robot's dedicated browser profile
(`.georep-robot/browser-profile`) and makes every subsequent headless sync
attempt crash immediately with `launchPersistentContext: Target page,
context or browser has been closed`. Fix:
```powershell
Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" | Where-Object { $_.CommandLine -match 'georep-robot' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```
then delete `.georep-robot\browser-profile\lockfile` if it's still there,
then retry `npm run robot:sync`.

**Portal shows a permanent loading/error state, robot log looks fine:**
That's the Graph-read side, not the robot — see the two Azure
AD/SharePoint requirements above. Test directly with Graph Explorer
(developer.microsoft.com/graph/graph-explorer) using the exact failing URL
from the browser console before assuming it's a code bug — most of the
time spent on this feature was chasing what turned out to be a
permission/scope issue, not application code.

**Notification thumbnail images don't open when clicked:**
Hard-refresh the portal (Ctrl+Shift+R) — `notifications.js` is loaded via a
plain `<script src>` tag with no cache-busting, so browsers can hang onto a
stale copy across deploys.

## Who to contact

Carin Pillay (cpillay@meridiangroup.co.za) built and maintains this. If
she's unavailable, whoever has Azure AD admin rights for Meridian Group's
tenant is the next best contact for the Graph/permission side; whoever has
access to this specific Windows machine (or wherever the scheduled task
gets moved to) is needed for the robot side.
