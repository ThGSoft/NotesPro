@echo off
setlocal
rem Copy ..\NotesPro into ..\NotesPro.github.
rem Folders and files listed in .gitignore are not copied. .git is kept local.

set "SRC=%~dp0..\NotesPro"
set "DST=%~dp0..\NotesPro.github"

if not exist "%SRC%\" (
  echo Source not found: %SRC%
  exit /b 1
)
if not exist "%DST%\" (
  echo Destination not found: %DST%
  exit /b 1
)
if not exist "%SRC%\.gitignore" (
  echo .gitignore not found: %SRC%\.gitignore
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-notespro-github.ps1" -Src "%SRC%" -Dst "%DST%"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo Sync failed.
  exit /b %RC%
)

echo.
echo Sync finished.
exit /b 0
