@echo off
rem Set the working directory to the folder containing this batch file so the export is saved next to it.
cd /d "%~dp0"

set "API_URL=https://127.0.0.1:8444/domi"
set "API_KEY=<YOUR_API_KEY>"
set "API_KEY_HEADER=X-API-Key"
set "EXPORT_DIR=%~dp0export"
set "VIEW_NAME=view_name"

rem Method: GET for export, PUT for insert. For PUT, modify BODY_PUT according to the actual columns of the primary table.
set "METHOD=PUT"
set "BODY_PUT={"rows":[{"column1":"value1","column2":"value2"}]}"
rem Alternatively, save JSON to a file (e.g., payload.json) and for PUT use:
rem set "BODY_PUT_FILE=%~dp0payload.json"
rem set "BODY_GET={"column1":"value1"}"

rem Note: A valid API key starts with KTWH...

if not "%~1"=="" set "VIEW_NAME=%~1"

setlocal EnableExtensions
set "URL=%API_URL%/%VIEW_NAME%"

rem Output file name: parameter or view_YYYYMMDD_HHMMSS.json
if not "%~2"=="" (
    set "OUTFILE=%~2"
) else (
    for /f %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TS=%%T"
    if not exist "%EXPORT_DIR%" mkdir "%EXPORT_DIR%"
    call set "OUTFILE=%EXPORT_DIR%\%VIEW_NAME%_%%TS%%.json"
)

echo Loading: OUTFILE=%OUTFILE%

rem Check if curl is available
where curl >nul 2>&1
if errorlevel 1 (
    echo Error: curl.exe not found. It is part of Windows 10/11. 1>&2
    pause
    exit /b 1
)

rem Select method. GET/POST returns data to a file (with optional filter body), PUT sends the specified body.
if /I "%METHOD%"=="GET" (
    call :do_get
) else if /I "%METHOD%"=="POST" (
    call :do_post
) else if /I "%METHOD%"=="PUT" (
    call :do_put
) else (
    echo Error: Unknown method "%METHOD%". Use GET, POST, or PUT. 1>&2
    pause
    exit /b 1
)

endlocal

rem For testing, leave pause so the console window stays open.
rem Remove if using the batch file in an automated task.
pause
exit /b 0

:do_get
rem If BODY_GET is not empty, it is sent as a JSON body for the GET request (filtered output).
if defined BODY_GET (
    for /f "delims=" %%H in ('curl -s -o "%OUTFILE%" -w "%%{http_code}" -X GET -H "Content-Type: application/json" -H "%API_KEY_HEADER%: %API_KEY%" -d "%BODY_GET%" -k "%URL%"') do set "HTTP_CODE=%%H"
) else (
    for /f "delims=" %%H in ('curl -s -o "%OUTFILE%" -w "%%{http_code}" -H "%API_KEY_HEADER%: %API_KEY%" -k "%URL%"') do set "HTTP_CODE=%%H"
)

if not defined HTTP_CODE set "HTTP_CODE=000"

if "%HTTP_CODE%"=="000" (
    echo Error: Server is not available ^(%URL%^) 1>&2
    if exist "%OUTFILE%" del "%OUTFILE%"
    pause
    exit /b 1
)

if not "%HTTP_CODE%"=="200" (
    echo Error: Server returned HTTP %HTTP_CODE% 1>&2
    type "%OUTFILE%" 1>&2
    echo. 1>&2
    del "%OUTFILE%"
    pause
    exit /b 1
)

echo Export saved: %OUTFILE%
goto :eof

:do_post
rem POST always sends BODY_GET as a filtering JSON.
if not defined BODY_GET (
    echo Error: POST requires BODY_GET with filtering. Use GET for full output. 1>&2
    pause
    exit /b 1
)
for /f "delims=" %%H in ('curl -s -o "%OUTFILE%" -w "%%{http_code}" -X POST -H "Content-Type: application/json" -H "%API_KEY_HEADER%: %API_KEY%" -d "%BODY_GET%" -k "%URL%"') do set "HTTP_CODE=%%H"

if not defined HTTP_CODE set "HTTP_CODE=000"

if "%HTTP_CODE%"=="000" (
    echo Error: Server is not available ^(%URL%^) 1>&2
    if exist "%OUTFILE%" del "%OUTFILE%"
    pause
    exit /b 1
)

if not "%HTTP_CODE%"=="200" (
    echo Error: Server returned HTTP %HTTP_CODE% 1>&2
    type "%OUTFILE%" 1>&2
    echo. 1>&2
    del "%OUTFILE%"
    pause
    exit /b 1
)

echo Export saved: %OUTFILE%
goto :eof

:do_put
if defined BODY_PUT_FILE (
    for /f "delims=" %%H in ('curl -s -o "%OUTFILE%" -w "%%{http_code}" -X PUT -H "Content-Type: application/json" -H "%API_KEY_HEADER%: %API_KEY%" -d @"%BODY_PUT_FILE%" -k "%URL%"') do set "HTTP_CODE=%%H"
) else (
    for /f "delims=" %%H in ('curl -s -o "%OUTFILE%" -w "%%{http_code}" -X PUT -H "Content-Type: application/json" -H "%API_KEY_HEADER%: %API_KEY%" -d "%BODY_PUT%" -k "%URL%"') do set "HTTP_CODE=%%H"
)

if not defined HTTP_CODE set "HTTP_CODE=000"

if "%HTTP_CODE%"=="000" (
    echo Error: Server is not available ^(%URL%^) 1>&2
    if exist "%OUTFILE%" del "%OUTFILE%"
    pause
    exit /b 1
)

if not "%HTTP_CODE%"=="200" (
    echo Error: Server returned HTTP %HTTP_CODE% 1>&2
    type "%OUTFILE%" 1>&2
    echo. 1>&2
    del "%OUTFILE%"
    pause
    exit /b 1
)

echo Insert successful. Response saved: %OUTFILE%
goto :eof