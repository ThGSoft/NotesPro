param(
    [Parameter(Mandatory = $true)][string]$Src,
    [Parameter(Mandatory = $true)][string]$Dst
)

$ErrorActionPreference = 'Stop'

$src = (Resolve-Path -LiteralPath $Src).Path
$dst = (Resolve-Path -LiteralPath $Dst).Path
$gitignore = Join-Path $src '.gitignore'
if (-not (Test-Path -LiteralPath $gitignore)) {
    throw ".gitignore not found: $gitignore"
}

function Get-GitignoreDirectories([string]$Root, [string]$IgnoreFile) {
    $found = New-Object System.Collections.Generic.List[string]
    foreach ($raw in [System.IO.File]::ReadAllLines($IgnoreFile)) {
        $line = $raw.Trim()
        if (-not $line -or $line.StartsWith('#') -or $line.StartsWith('!')) { continue }
        $directoryOnly = $line.EndsWith('/')
        $pattern = $line.TrimEnd('/')
        if ($pattern.StartsWith('/')) { $pattern = $pattern.Substring(1) }
        if ($pattern -match '[\*\?\[\]]') { continue }
        $full = Join-Path $Root ($pattern.Replace('/', '\'))
        if (($directoryOnly -or (Test-Path -LiteralPath $full -PathType Container)) -and
            (Test-Path -LiteralPath $full -PathType Container)) {
            $found.Add($pattern.Replace('/', '\'))
        }
    }
    $top = New-Object System.Collections.Generic.List[string]
    foreach ($dir in ($found | Sort-Object { $_.Length })) {
        $covered = $false
        foreach ($kept in $top) {
            if ($dir -eq $kept -or $dir.StartsWith($kept + '\')) { $covered = $true; break }
        }
        if (-not $covered) { $top.Add($dir) }
    }
    return $top
}

function Test-UnderDirectory([string]$Relative, [string[]]$Directories) {
    foreach ($dir in $Directories) {
        if ($Relative -eq $dir -or $Relative.StartsWith($dir + '\')) { return $true }
    }
    return $false
}

function Get-IgnoredFiles([string]$Repo, [string[]]$RelativePosix) {
    if (-not $RelativePosix -or $RelativePosix.Count -eq 0) { return @() }
    $inFile = Join-Path $env:TEMP ("np-sync-ignore-" + [guid]::NewGuid().ToString() + ".txt")
    $utf8 = New-Object System.Text.UTF8Encoding $false
    try {
        [System.IO.File]::WriteAllText($inFile, ($RelativePosix -join "`n") + "`n", $utf8)
        $output = & cmd.exe /c "git -C `"$Repo`" -c core.quotepath=false check-ignore --stdin --no-index < `"$inFile`""
        return @($output | Where-Object { $_ })
    } finally {
        Remove-Item -LiteralPath $inFile -Force -ErrorAction SilentlyContinue
    }
}

$skipDirs = @(Get-GitignoreDirectories $src $gitignore)
$skipDirs += '.git'

Write-Host "Using $gitignore"
Write-Host "Not syncing folders:"
foreach ($dir in ($skipDirs | Sort-Object)) {
    Write-Host "  $dir"
}

$candidates = New-Object System.Collections.Generic.List[string]
$pending = New-Object System.Collections.Generic.Stack[string]
$pending.Push($src)
while ($pending.Count -gt 0) {
    $directory = $pending.Pop()
    foreach ($item in (Get-ChildItem -LiteralPath $directory -Force)) {
        $relative = $item.FullName.Substring($src.Length).TrimStart('\')
        if (Test-UnderDirectory $relative $skipDirs) { continue }
        if ($item.PSIsContainer) {
            $pending.Push($item.FullName)
        } else {
            $candidates.Add($relative)
        }
    }
}

$posix = @($candidates | ForEach-Object { $_.Replace('\', '/') })
$ignoredFiles = @(Get-IgnoredFiles $src $posix)
$ignoredSet = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($path in $ignoredFiles) {
    if ($path) { [void]$ignoredSet.Add($path.Trim()) }
}

Write-Host ("Not syncing {0} ignored files from .gitignore" -f $ignoredSet.Count)

$copied = 0
$unchanged = 0
foreach ($relative in $candidates) {
    $posixPath = $relative.Replace('\', '/')
    if ($ignoredSet.Contains($posixPath)) { continue }
    $from = Join-Path $src $relative
    $to = Join-Path $dst $relative
    $parent = Split-Path -Parent $to
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $doCopy = $true
    if (Test-Path -LiteralPath $to) {
        $sourceItem = Get-Item -LiteralPath $from
        $destItem = Get-Item -LiteralPath $to
        if ($sourceItem.Length -eq $destItem.Length -and
            $sourceItem.LastWriteTimeUtc -eq $destItem.LastWriteTimeUtc) {
            $doCopy = $false
        }
    }
    if ($doCopy) {
        Copy-Item -LiteralPath $from -Destination $to -Force
        $copied++
    } else {
        $unchanged++
    }
}

Write-Host "Copied $copied files, left $unchanged unchanged."
