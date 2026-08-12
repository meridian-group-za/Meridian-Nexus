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

## Nexus access

Nexus requests the delegated Microsoft Graph `Files.Read` scope and reads the private file from SharePoint. A signed-in user may see a one-time **Connect SharePoint** button if Microsoft requires consent. Users must have permission to the Meridian Nexus SharePoint site.
