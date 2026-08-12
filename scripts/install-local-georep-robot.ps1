$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeCandidates = @(
  if ($nodeCommand) { $nodeCommand.Source }
  (Join-Path $env:ProgramFiles 'nodejs\node.exe')
  if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe' }
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$node = $nodeCandidates | Select-Object -First 1
if (-not $node) { throw 'Node.js was not found. Install Node.js 18 or newer, then run setup again.' }
$npm = Join-Path (Split-Path -Parent $node) 'npm.cmd'
if (-not (Test-Path -LiteralPath $npm)) { throw "npm.cmd was not found beside Node.js at $node." }
$script = Join-Path $repoRoot 'scripts\local-georep-robot.mjs'
$taskName = 'Meridian Nexus - GeoRep Notifications'

Push-Location $repoRoot
try {
  & $npm install
  & $node $script check
  & $node $script login
  if ($LASTEXITCODE -ne 0) { throw 'The dedicated browser sign-in was not completed.' }
  & $node $script sync
  if ($LASTEXITCODE -ne 0) { throw 'The first GeoRep-to-SharePoint sync did not complete.' }

  $action = New-ScheduledTaskAction -Execute $node -Argument ('"{0}" sync' -f $script) -WorkingDirectory $repoRoot
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
    -RepetitionInterval (New-TimeSpan -Minutes 15)
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId ("{0}\{1}" -f $env:USERDOMAIN, $env:USERNAME) `
    -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description 'Copies private GeoRep notifications and images to Meridian Nexus SharePoint every 15 minutes.' -Force | Out-Null

  Write-Host "Installed scheduled task: $taskName" -ForegroundColor Green
  Write-Host 'The first private sync completed successfully.' -ForegroundColor Green
} finally {
  Pop-Location
}
