#requires -Version 5.1
<#
  Local -> GitHub sync for Mergebound.
  Usage:  .\sync.ps1 "commit message"
          .\sync.ps1                  (push already-committed work only)

  Safe by design: rebases onto anything Replit pushed before it pushes,
  then verifies local HEAD matches origin/main so the two never drift.

  Windows-only convenience wrapper — it is NOT part of the app, and Replit
  ignores it. On macOS/Linux the equivalent is just:
      git pull --rebase && git add -A && git commit -m "..." && git push
  Committed (rather than kept local) so it exists on every machine the
  owner develops from.
#>
param(
    [Parameter(Position = 0)]
    [string]$Message
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Invoke-Git {
    param([string[]]$GitArgs, [switch]$AllowFail)
    $out = & git @GitArgs
    if ($LASTEXITCODE -ne 0 -and -not $AllowFail) {
        throw "git $($GitArgs -join ' ') failed (exit $LASTEXITCODE)"
    }
    return $out
}

$branch = (Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD')).Trim()
Write-Host "branch: $branch" -ForegroundColor Cyan

# 1. Pick up anything Replit (or the Replit agent) pushed while we were working.
Invoke-Git @('fetch', 'origin', $branch) | Out-Null
$behind = (Invoke-Git @('rev-list', '--count', "HEAD..origin/$branch")).Trim()
if ([int]$behind -gt 0) {
    Write-Host "origin is $behind commit(s) ahead - rebasing local work on top" -ForegroundColor Yellow
    $dirty = Invoke-Git @('status', '--porcelain')
    $stashed = $false
    if ($dirty) {
        Invoke-Git @('stash', 'push', '-u', '-m', 'sync.ps1 autostash') | Out-Null
        $stashed = $true
    }
    & git rebase "origin/$branch"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "REBASE CONFLICT - resolve it, then run: git rebase --continue" -ForegroundColor Red
        if ($stashed) { Write-Host "Your uncommitted work is in the stash: git stash pop" -ForegroundColor Red }
        exit 1
    }
    if ($stashed) {
        & git stash pop
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Stash pop conflicted - resolve, then re-run sync." -ForegroundColor Red
            exit 1
        }
    }
}

# 2. Commit, if there is anything to commit and a message was given.
$pending = Invoke-Git @('status', '--porcelain')
if ($pending) {
    if (-not $Message) {
        Write-Host "Uncommitted changes present but no commit message given:" -ForegroundColor Red
        & git status --short
        Write-Host 'Run:  .\sync.ps1 "your message"' -ForegroundColor Red
        exit 1
    }
    Invoke-Git @('add', '-A') | Out-Null
    Invoke-Git @('commit', '-m', $Message) | Out-Null
    Write-Host "committed: $Message" -ForegroundColor Green
}
elseif ($Message) {
    Write-Host "nothing to commit - pushing existing commits" -ForegroundColor DarkGray
}

# 3. Push.
$ahead = (Invoke-Git @('rev-list', '--count', "origin/$branch..HEAD")).Trim()
if ([int]$ahead -eq 0) {
    Write-Host "already in sync with origin/$branch - nothing to push" -ForegroundColor Green
    exit 0
}
& git push origin $branch
if ($LASTEXITCODE -ne 0) { throw "push failed" }

# 4. Verify the two really do match.
Invoke-Git @('fetch', 'origin', $branch) | Out-Null
$local = (Invoke-Git @('rev-parse', 'HEAD')).Trim()
$remote = (Invoke-Git @('rev-parse', "origin/$branch")).Trim()
if ($local -ne $remote) {
    Write-Host "MISMATCH: local $local vs origin $remote" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "pushed $ahead commit(s). local == origin/$branch @ $($local.Substring(0,7))" -ForegroundColor Green
Write-Host "Now in Replit: Git pane -> Pull  (or run 'git pull' in the Replit shell)" -ForegroundColor Cyan
