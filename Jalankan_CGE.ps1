# Platform CGE Indonesia - PowerShell Launcher
$Host.UI.RawUI.WindowTitle = "Platform CGE Indonesia"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║       PLATFORM CGE INDONESIA v2.0            ║" -ForegroundColor Green
Write-Host "  ║   Computable General Equilibrium Regional    ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

# Cek folder cge-platform
if (-not (Test-Path "cge-platform")) {
    Write-Host "  [!] Folder cge-platform tidak ditemukan!" -ForegroundColor Red
    Read-Host "Tekan Enter untuk keluar"
    exit 1
}

Set-Location "cge-platform"

# Install jika belum ada node_modules
if (-not (Test-Path "node_modules")) {
    Write-Host "  [*] Install dependencies (sekali saja)..." -ForegroundColor Yellow
    npm install
}

# Cek apakah sudah berjalan
$port = netstat -an 2>$null | Select-String ":5173"
if ($port) {
    Write-Host "  [*] Server sudah berjalan - membuka browser..." -ForegroundColor Cyan
    Start-Process "http://localhost:5173"
    exit 0
}

Write-Host "  [*] Memulai server..." -ForegroundColor Cyan
Write-Host "  [*] Browser terbuka otomatis dalam 3 detik" -ForegroundColor Cyan
Write-Host ""
Write-Host "  [!] Jangan tutup jendela ini!" -ForegroundColor Yellow
Write-Host ""

# Buka browser di background setelah 3 detik
Start-Job -ScriptBlock {
    Start-Sleep 3
    Start-Process "http://localhost:5173"
} | Out-Null

# Jalankan server
npm run dev
