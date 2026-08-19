@echo off
REM Builds the native Scene Director + Texture Paint validation host.
REM   Build\PanelValidation.bat
REM   Build\PanelValidation.bat Debug
REM   Build\PanelValidation.bat Release Run

setlocal
set SelectedConfiguration=%1
if "%SelectedConfiguration%"=="" set SelectedConfiguration=Release
set RunArgument=
if /I "%2"=="Run" set RunArgument=-Run

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0PanelValidation.ps1" -Configuration %SelectedConfiguration% %RunArgument%
exit /b %ERRORLEVEL%
