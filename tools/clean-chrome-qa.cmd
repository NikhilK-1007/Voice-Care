@echo off
REM Removes the throwaway Chrome profiles that browser-automation tools leave on
REM the Desktop (folders named .chrome-qa-reg-<timestamp> / .chrome-qa-profile-<ts>).
REM They hold no patient data and no logins: they are temporary browser profiles.
REM Double-click this file any time the folders pile up.

set "TARGET=%USERPROFILE%\Desktop"
echo Cleaning throwaway Chrome profiles in "%TARGET%" ...

for /d %%D in ("%TARGET%\.chrome-qa-*") do (
  echo   removing %%~nxD
  rmdir /s /q "%%~fD"
)

echo Done.
timeout /t 3 >nul
