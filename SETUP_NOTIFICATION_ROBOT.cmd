@echo off
setlocal
cd /d "%~dp0"
echo Meridian Nexus - GeoRep Notification Robot
echo.
echo A dedicated Edge window will open with GeoRep and SharePoint tabs.
echo Sign into both pages, confirm each folder/page opens, then close Edge.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\install-local-georep-robot.ps1"
if errorlevel 1 (
  echo.
  echo Setup did not complete. Review .georep-robot\logs\robot.log and run this file again.
  pause
  exit /b 1
)
echo.
echo Setup is complete. The robot will run every 15 minutes while you are signed into Windows.
pause
