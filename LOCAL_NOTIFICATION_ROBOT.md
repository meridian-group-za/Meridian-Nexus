# Local GeoRep notification robot

The robot uses a dedicated Microsoft Edge profile and never stores a password in source code.
Every 15 minutes it:

1. opens the authenticated GeoRep Notifications page;
2. reads every ContentFeed API page;
3. downloads uploaded notification images using the active GeoRep session;
4. uploads `notifications.json` and the images to the private SharePoint folder; and
5. closes the browser.

Private destination:

`/sites/MeridianNexus/Shared Documents/Connect/Notifications`

The browser profile and logs are stored under `.georep-robot/` and are excluded from Git.

## Install

Double-click `SETUP_NOTIFICATION_ROBOT.cmd`, or run this from the repository directory:

```powershell
npm.cmd run robot:install
```

Sign into GeoRep in the first browser tab and SharePoint in the second. Close the browser after both pages open successfully. Setup performs the first sync before it registers the scheduled task.

The scheduled task is named **Meridian Nexus - GeoRep Notifications**.

If either session expires, the robot does not overwrite SharePoint. It writes a sign-in message to:

`.georep-robot/logs/robot.log`

Run `npm.cmd run robot:login` again to renew both sessions.

If the machine running the robot has Edge configured to keep running in the background after the window closes, closing the sign-in window may not fully release its browser profile lock, and the next scheduled sync can fail immediately even though sign-in succeeded. If a sync fails right after a successful login, check for and kill any lingering `msedge.exe` process referencing `.georep-robot` in its command line, then delete `.georep-robot\browser-profile\lockfile` if present, and retry.

As of 2026-08-13, if GeoRep or SharePoint sign-in expires, the robot also shows a one-time Windows tray notification (in addition to the `robot.log` entry) telling you to run `robot:login` again — you don't have to proactively check the log.

## Nexus access

Nexus requests the delegated Microsoft Graph **`Sites.Read.All`** scope (not `Files.Read` — that narrower scope only covers a user's own OneDrive plus items explicitly shared with them by name, and does not extend to a SharePoint team site's document library reached through normal site membership) and reads the private file from SharePoint. The app registration is `73cf19b5-ae3e-4a6e-995a-c539b75a37c5`. A signed-in user may see a one-time consent prompt the first time. Users must have permission to the Meridian Nexus SharePoint site, and the `Connect/Notifications` folder specifically must be shared with whichever group represents "everyone who should see notifications" — delegated Graph permission only lets someone read what they already have SharePoint access to.
