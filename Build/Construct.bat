@echo off
REM Construct.bat  the shell entry point. Forwards to Construct.ps1, which holds the whole build.
REM
REM   Build\Construct.bat
REM   Build\Construct.bat Debug
REM   Build\Construct.bat Release SlateMath
REM   Build\Construct.bat Release Application PanelValidationHost

setlocal

set SelectedConfiguration=%1
if "%SelectedConfiguration%"=="" set SelectedConfiguration=Release

set SelectedUnit=%2
set SelectedSubject=%3

if not "%SelectedSubject%"=="" (
    REM A host needs the static libraries; subject builds therefore retain the whole prerequisite graph.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Construct.ps1" -Configuration %SelectedConfiguration% -Subject %SelectedSubject%
) else if not "%SelectedUnit%"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Construct.ps1" -Configuration %SelectedConfiguration% -Unit %SelectedUnit%
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Construct.ps1" -Configuration %SelectedConfiguration%
)

exit /b %ERRORLEVEL%
