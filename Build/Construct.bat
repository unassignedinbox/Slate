@echo off
REM Construct.bat - the shell entry point. Forwards to Construct.ps1, which holds the whole build.
REM
REM ASCII only in this file. cmd.exe reads it in the OEM code page, so a UTF-8 em-dash in a REM line
REM arrives as mojibake that cmd then tries to execute - "'M' is not recognized as an internal or
REM external command". Every other file in the tree is UTF-8; this one cannot be.
REM
REM   Build\Construct.bat
REM   Build\Construct.bat Debug
REM   Build\Construct.bat Release SlateMath

setlocal

set SelectedConfiguration=%1
if "%SelectedConfiguration%"=="" set SelectedConfiguration=Release

set SelectedUnit=%2

if "%SelectedUnit%"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Construct.ps1" -Configuration %SelectedConfiguration%
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Construct.ps1" -Configuration %SelectedConfiguration% -Unit %SelectedUnit%
)

exit /b %ERRORLEVEL%
