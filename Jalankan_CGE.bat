@echo off
title Platform CGE Indonesia
color 0A

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║       PLATFORM CGE INDONESIA v2.0            ║
echo  ║   Computable General Equilibrium Regional    ║
echo  ╚══════════════════════════════════════════════╝
echo.

:: Pindah ke folder script ini berada
cd /d "%~dp0"

:: Cek apakah folder cge-platform ada
if not exist "cge-platform" (
    echo  [!] Folder cge-platform tidak ditemukan!
    echo  [!] Pastikan file ini ada di folder yang sama dengan cge-platform
    echo.
    pause
    exit /b 1
)

:: Masuk ke folder project
cd cge-platform

:: Cek apakah node_modules ada
if not exist "node_modules" (
    echo  [*] Pertama kali dijalankan - install dependencies...
    echo  [*] Mohon tunggu beberapa menit...
    echo.
    call npm install
    if errorlevel 1 (
        echo  [!] Gagal install dependencies!
        pause
        exit /b 1
    )
)

:: Cek apakah port 5173 sudah dipakai
netstat -an 2>nul | find ":5173" >nul 2>&1
if not errorlevel 1 (
    echo  [*] Server sudah berjalan - membuka browser...
    timeout /t 1 /nobreak >nul
    start "" "http://localhost:5173"
    exit /b 0
)

echo  [*] Menjalankan server...
echo  [*] Browser akan terbuka otomatis dalam 3 detik
echo.
echo  [!] Jangan tutup jendela ini selama menggunakan platform
echo  [!] Tekan Ctrl+C untuk menghentikan server
echo.

:: Buka browser setelah delay 3 detik (background)
start /b cmd /c "timeout /t 3 /nobreak >nul && start "" http://localhost:5173"

:: Jalankan Vite dev server
call npm run dev

pause
