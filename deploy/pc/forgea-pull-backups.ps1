# Copies the server's backups to this PC and keeps the newest few of each environment here.
# Run by a Windows scheduled task ("Forgea backups", daily and at sign-in; see deploy/README.md,
# "Backups on your PC"). Uses its own SSH key, which the server lets do nothing but list and
# send backups (forgea-backup-serve). The files are encrypted: restoring one needs the backup
# password from backup.env.
param(
  [string]$Server = '31.97.116.192',
  [string]$Destination = 'C:\Files\Backups\Forgea',
  [int]$Keep = 5,
  [string]$Key = "$env:USERPROFILE\.ssh\forgea_backups"
)
$ErrorActionPreference = 'Stop'
$pattern = '^(?<env>production|staging)/(?<file>forgea-(production|staging)-\d{4}-\d{2}-\d{2}-\d{6}(-[a-z]{1,20}(-[a-z]{1,20})?)?\.tar) (?<size>\d+)$'
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$log = Join-Path $Destination 'pull.log'
function Log([string]$line) {
  Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $line"
}
$ssh = @('-i', $Key, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=20', "backups@$Server")

try {
  $list = & ssh.exe @ssh list
  if ($LASTEXITCODE -ne 0) { throw "the server did not answer (ssh exit $LASTEXITCODE)" }
  $copied = 0
  foreach ($line in $list) {
    if ($line -notmatch $pattern) { continue }
    $envName = $Matches['env']; $file = $Matches['file']; $size = [long]$Matches['size']
    # The file must belong to the environment it is listed under.
    if (-not $file.StartsWith("forgea-$envName-")) { continue }
    $folder = Join-Path $Destination $envName
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    $target = Join-Path $folder $file
    if ((Test-Path $target) -and (Get-Item $target).Length -eq $size) { continue }
    $part = "$target.part"
    # cmd's redirection writes the bytes as they come (PowerShell's would change them).
    & cmd.exe /c "ssh.exe -i `"$Key`" -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=20 backups@$Server get $envName/$file > `"$part`""
    if ($LASTEXITCODE -ne 0 -or (Get-Item $part).Length -ne $size) {
      Remove-Item -Force $part -ErrorAction SilentlyContinue
      throw "download of $envName/$file failed"
    }
    Move-Item -Force $part $target
    $copied++
    Log "copied $envName/$file ($([math]::Round($size / 1MB, 1)) MB)"
  }
  # Only the newest $Keep of each environment stay on this PC (names sort by date).
  foreach ($envName in 'production', 'staging') {
    $folder = Join-Path $Destination $envName
    if (-not (Test-Path $folder)) { continue }
    Get-ChildItem $folder -Filter "forgea-$envName-*.tar" | Sort-Object Name -Descending |
      Select-Object -Skip $Keep | ForEach-Object {
        Remove-Item -Force $_.FullName
        Log "removed $envName/$($_.Name) (keeping the newest $Keep)"
      }
  }
  Log "done: $copied new"
} catch {
  Log "FAILED: $($_.Exception.Message)"
  exit 1
}
