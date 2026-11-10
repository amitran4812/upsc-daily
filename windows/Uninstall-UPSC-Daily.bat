@echo off
title UPSC Daily - uninstall
taskkill /F /FI "WINDOWTITLE eq UPSC*" >nul 2>nul
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='pythonw.exe'\" | Where-Object { $_.CommandLine -like '*UPSCDaily*launcher.pyw*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\UPSC Daily.vbs" 2>nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\UPSC Daily.lnk" 2>nul
del "%USERPROFILE%\Desktop\UPSC Daily.url" 2>nul
rmdir /S /Q "%LOCALAPPDATA%\UPSCDaily\app" 2>nul
powershell -NoProfile -Command "Start-Process netsh -Verb RunAs -WindowStyle Hidden -ArgumentList 'advfirewall firewall delete rule name=\"UPSC Daily\"'" 2>nul
echo UPSC Daily removed. Your notes and PDFs are kept in %LOCALAPPDATA%\UPSCDaily\data (delete that folder to remove them too).
pause
