@echo off
setlocal EnableExtensions
title UPSC Daily - installer
echo.
echo  ==============================================
echo     UPSC Daily - installing on this computer
echo  ==============================================
echo.
set "SRC=%~dp0.."
set "DEST=%LOCALAPPDATA%\UPSCDaily\app"
set "PORT=8765"

rem ---- 1. Python -------------------------------------------------------
set "PY="
for %%P in ("%LOCALAPPDATA%\Programs\Python\Python313\python.exe" "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" "%LOCALAPPDATA%\Programs\Python\Python311\python.exe") do (
  if not defined PY if exist %%P set "PY=%%~P"
)
if not defined PY (
  where py >nul 2>nul && for /f "delims=" %%i in ('py -3 -c "import sys;print(sys.executable)" 2^>nul') do set "PY=%%i"
)
if not defined PY (
  echo  Installing Python 3.12 (one time, about 2 minutes^)...
  winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
  if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
)
if not defined PY (
  echo.
  echo  Could not install Python automatically.
  echo  Please install it from https://www.python.org/downloads/ and run this file again.
  pause & exit /b 1
)
echo  Python: %PY%

rem ---- 2. Copy the app --------------------------------------------------
echo  Copying the portal to %DEST% ...
if not exist "%DEST%" mkdir "%DEST%"
robocopy "%SRC%" "%DEST%" /E /NFL /NDL /NJH /NJS /NP /XD data __pycache__ .git >nul

rem ---- 3. Private Python environment + packages -------------------------
if not exist "%DEST%\.venv\Scripts\pythonw.exe" (
  echo  Setting up (one time^)...
  "%PY%" -m venv "%DEST%\.venv" || (echo  Could not create the environment. & pause & exit /b 1)
)
echo  Installing components...
"%DEST%\.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q --upgrade pip >nul
"%DEST%\.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r "%DEST%\requirements.txt" || (echo  Package install failed. Check the internet connection and run again. & pause & exit /b 1)

rem ---- 4. Start with Windows (hidden, no window) ------------------------
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
del "%STARTUP%\UPSC Daily.vbs" 2>nul
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:APPDATA+'\Microsoft\Windows\Start Menu\Programs\Startup\UPSC Daily.lnk'); $s.TargetPath='%DEST%\.venv\Scripts\pythonw.exe'; $s.Arguments='\"%DEST%\windows\launcher.pyw\"'; $s.WorkingDirectory='%DEST%'; $s.WindowStyle=7; $s.Save()"
rem Desktop shortcut that opens the portal in the browser
> "%USERPROFILE%\Desktop\UPSC Daily.url" (
  echo [InternetShortcut]
  echo URL=http://localhost:%PORT%/
  echo IconFile=%DEST%\app\static\icon.ico
  echo IconIndex=0
)

rem ---- 5. Allow the tablet on the home Wi-Fi (asks for permission once) --
echo  Allowing the tablet to connect over home Wi-Fi (Windows may ask for permission)...
powershell -NoProfile -Command "Start-Process netsh -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList 'advfirewall firewall delete rule name=\"UPSC Daily\"' ; Start-Process netsh -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList 'advfirewall firewall add rule name=\"UPSC Daily\" dir=in action=allow protocol=TCP localport=%PORT% profile=private'" 2>nul

rem ---- 6. Start it now ----------------------------------------------------
start "" "%DEST%\.venv\Scripts\pythonw.exe" "%DEST%\windows\launcher.pyw"
timeout /t 6 /nobreak >nul
start "" "http://localhost:%PORT%/"

echo.
echo  ==============================================
echo   Done! UPSC Daily is running and will start
echo   by itself every time Windows starts.
echo.
echo   On this PC:   http://localhost:%PORT%
echo   On the tablet (same Wi-Fi), open one of:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /R /C:"IPv4"') do for /f "tokens=* delims= " %%b in ("%%a") do echo        http://%%b:%PORT%
echo  ==============================================
echo.
pause
