CARA MENJALANKAN PLATFORM CGE INDONESIA
========================================

CARA TERMUDAH (Sekali Klik):
  → Klik dua kali file: Jalankan_CGE.bat

CARA ALTERNATIF:
  → Klik dua kali: Jalankan_CGE.vbs  (tanpa jendela CMD)
  → Atau klik kanan Jalankan_CGE.ps1 → Run with PowerShell

STRUKTUR FOLDER YANG BENAR:
  📁 CGE rembang  ├── Jalankan_CGE.bat     ← klik ini
  ├── Jalankan_CGE.vbs
  ├── Jalankan_CGE.ps1
  ├── README_Cara_Pakai.txt
  └── 📁 cge-platform       ├── src       │   └── App.jsx    ← kode platform
       ├── package.json
       └── node_modules
PERTAMA KALI DIJALANKAN:
  - Install dependencies otomatis (butuh internet, ~1-2 menit)
  - Selanjutnya langsung buka tanpa perlu internet

MENGHENTIKAN SERVER:
  - Tekan Ctrl+C di jendela CMD yang terbuka
  - Atau tutup jendela CMD

URL PLATFORM:
  http://localhost:5173

TROUBLESHOOTING:
  - Jika browser tidak terbuka otomatis → ketik manual: http://localhost:5173
  - Jika error "node tidak dikenal" → install Node.js dari nodejs.org
  - Jika port sudah dipakai → server sudah berjalan, buka browser langsung
