import { useState, useMemo, useCallback, useEffect, useRef } from "react";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ReferenceLine, RadarChart, PolarGrid, PolarAngleAxis,
  Radar, PieChart, Pie, Cell, Legend, AreaChart, Area, LineChart, Line
} from "recharts";

// ─────────────────────────────────────────────
// UTILITAS DOWNLOAD & EXPORT
// ─────────────────────────────────────────────

// Download file helper — menggunakan data URL agar reliable di semua browser
function downloadBlob(blob, filename) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const a = document.createElement("a");
    a.href = e.target.result;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 500);
  };
  reader.readAsDataURL(blob);
}

// Buka laporan HTML di tab baru - menggunakan data URI (paling reliable)
function openLaporanTab(html) {
  // Encode ke base64 data URI - tidak bergantung pada popup blocker
  const encoded = "data:text/html;charset=utf-8," + encodeURIComponent(html);
  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
  } else {
    // Fallback: download sebagai file jika popup diblokir
    const a = document.createElement("a");
    a.href  = encoded;
    a.download = "Laporan_CGE.html";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

// ── CSV / EXCEL (via CSV) ──
function sektor2CSV(sektor, daerahNama, tahun) {
  const header = ["No","Nama Sektor","Kelompok","Output (Juta Rp)","NTB (Juta Rp)",
    "Upah (Juta Rp)","Surplus (Juta Rp)","VA/Output (%)","BL","FL","BL Norm","FL Norm","Multiplier Output"].join(",");
  const rows = sektor.map(s =>
    [s.id, `"${s.nama}"`, s.grp, s.output, s.ntb, s.upah, Math.round(s.ntb-s.upah),
     (s.ntb/s.output*100).toFixed(2), s.bl.toFixed(4), s.fl.toFixed(4),
     s.bl_n.toFixed(4), s.fl_n.toFixed(4), s.mult.toFixed(4)].join(",")
  );
  const csv = [
    `# Tabel I-O Regional – ${daerahNama} ${tahun} (Hasil Regionalisasi RAS)`,
    `# Sumber: Platform CGE Indonesia v2.0`,
    ", header, ...rows, ",
    `# Total Output,${sektor.reduce((a,b)=>a+b.output,0)}`,
    `# Total NTB,${sektor.reduce((a,b)=>a+b.ntb,0)}`,
    `# Total Upah,${sektor.reduce((a,b)=>a+b.upah,0)}`,
  ].join("\n");
  return new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
}

function sam2CSV(SAM, daerahNama, tahun) {
  const labels = SAM.labels || [];
  const matrix = SAM.matrix || [];
  const header = ["Akun \\ Akun", ...labels].join(",");
  const rows = matrix.map((row, i) =>
    [`"${labels[i]}"`, ...row.map(v => Math.round(v))].join(",")
  );
  const totBaris = matrix.map(row => row.reduce((a,b)=>a+b,0));
  const totKolom = labels.map((_,j) => matrix.reduce((a,row)=>a+row[j],0));
  const csv = [
    `# Social Accounting Matrix (SAM) 7x7 – ${daerahNama} ${tahun}`,
    `# Satuan: Juta Rupiah`,
    `# Platform CGE Indonesia v2.0`,
    ", header, ...rows, ",
    `"Total Kolom",${totKolom.map(v=>Math.round(v)).join(",")}`,
    "", "# Multiplier SAM (akun endogen)",
    `"Produksi",${(SAM.mult||[])[0]||""}`,
    `"TK",${(SAM.mult||[])[1]||""}`,
    `"Kapital",${(SAM.mult||[])[2]||""}`,
    `"RT",${(SAM.mult||[])[3]||""}`,
  ].join("\n");
  return new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
}

function linkage2CSV(sektor, daerahNama, tahun) {
  const header = ["No","Nama Sektor","Kelompok","BL","FL","BL Norm","FL Norm",
    "Multiplier","Kuadran","Keterangan"].join(",");
  const rows = sektor.map(s => {
    const q = s.bl_n>1&&s.fl_n>1?"I-Kunci":s.bl_n<=1&&s.fl_n>1?"II-Pemimpin":s.bl_n>1&&s.fl_n<=1?"III-Pengikut":"IV-Independen";
    const ket = q==="I-Kunci"?"Prioritas kebijakan utama":q==="II-Pemimpin"?"Lokomotif hilirisasi":q==="III-Pengikut"?"Kuat sisi hulu":"Relatif terisolasi";
    return [s.id,`"${s.nama}"`,s.grp,s.bl.toFixed(4),s.fl.toFixed(4),s.bl_n.toFixed(4),s.fl_n.toFixed(4),s.mult.toFixed(4),q,`"${ket}"`].join(",");
  });
  const csv = [
    `# Analisis Keterkaitan Sektoral – ${daerahNama} ${tahun}`,
    `# Metode: Matriks Leontief (I-A)^-1`,
    "", header, ...rows,
  ].join("\n");
  return new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
}

// ── LAPORAN HTML → bisa Print/Save as PDF dari browser ──

function generateLaporanHTML(D, cge, stype, amt) {
  var sektor = D.sektor || [];
  var makro  = D.makro  || {};
  var tk     = D.tk     || {};
  var SAM    = D.SAM    || {};
  var s      = cge ? cge.s : null;
  var tgl    = new Date().toLocaleDateString("id-ID",{day:"numeric",month:"long",year:"numeric"});

  function fmtN(n,d) {
    d = d||0;
    if (typeof n !== "number" || isNaN(n)) return "-";
    return n.toLocaleString("id-ID",{maximumFractionDigits:d});
  }
  function sf(v,d) {
    d = d||2;
    if (typeof v !== "number" || isNaN(v)) return "0";
    return v.toFixed(d);
  }
  function pct(num, den, d) {
    d = d||1;
    if (!den || isNaN(num) || isNaN(den)) return "0";
    return (num/den*100).toFixed(d);
  }

  // CSS
  var css = [
    "@page{size:A4;margin:20mm 18mm}",
    "*{box-sizing:border-box;margin:0;padding:0}",
    "body{font-family:Arial,sans-serif;font-size:11pt;color:#1a1a2e;line-height:1.6;background:#fff}",
    ".cover{text-align:center;padding:60px 20px 40px;page-break-after:always}",
    "h1.sec{font-size:16pt;color:#1e3a5f;border-bottom:3px solid #22c55e;padding-bottom:6px;margin:28px 0 14px}",
    "h2.sub{font-size:13pt;color:#1e6b3c;margin:20px 0 8px}",
    "p{margin-bottom:8px;text-align:justify}",
    ".kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0}",
    ".kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;border-left:4px solid #22c55e}",
    ".kpi .lbl{font-size:9pt;color:#64748b;text-transform:uppercase;margin-bottom:4px}",
    ".kpi .val{font-size:17pt;font-weight:bold;color:#1e3a5f}",
    ".kpi .unit{font-size:10pt;margin-left:4px}",
    "table{width:100%;border-collapse:collapse;margin:10px 0 16px;font-size:10pt}",
    "th{background:#1e3a5f;color:#fff;padding:8px 10px;text-align:left}",
    "td{padding:7px 10px;border-bottom:1px solid #e2e8f0}",
    "tr:nth-child(even) td{background:#f8fafc}",
    ".badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:8.5pt;font-weight:bold}",
    ".g{background:#dcfce7;color:#166534}.b{background:#dbeafe;color:#1e40af}",
    ".y{background:#fef9c3;color:#854d0e}.p{background:#f3e8ff;color:#6b21a8}",
    ".info{background:#f0fdf4;border-left:4px solid #22c55e;border-radius:4px;padding:12px 14px;margin:10px 0}",
    ".warn{background:#fffbeb;border-left:4px solid #f59e0b;border-radius:4px;padding:12px 14px;margin:10px 0}",
    ".shock{background:#eff6ff;border-left:4px solid #3b82f6;border-radius:4px;padding:12px 14px;margin:10px 0}",
    ".pb{page-break-before:always}",
    ".two{display:grid;grid-template-columns:1fr 1fr;gap:16px}",
    ".foot{font-size:9pt;color:#94a3b8;text-align:center;margin-top:30px;padding-top:10px;border-top:1px solid #e2e8f0}",
    "@media print{.noprint{display:none}}"
  ].join("");

  function kpi(lbl, val, unit, col) {
    return "<div class='kpi' style='border-left-color:"+col+"'>"
      +"<div class='lbl'>"+lbl+"</div>"
      +"<div class='val'>"+val+"<span class='unit' style='color:"+col+"'>"+unit+"</span></div>"
      +"</div>";
  }

  // TABEL SEKTOR
  var sektorRows = "";
  for (var i=0; i<sektor.length; i++) {
    var s2 = sektor[i];
    var gc = s2.grp==="Industri"?"y":s2.grp==="Pertanian"||s2.grp==="Perikanan"?"g":s2.grp==="Jasa"?"b":"p";
    var mc = s2.mult>=2?"#166534":s2.mult>=1.5?"#854d0e":"#374151";
    var vaPct = s2.output>0 ? (s2.ntb/s2.output*100).toFixed(1) : "0";
    sektorRows += "<tr>"
      +"<td>"+s2.id+"</td><td>"+s2.nama+"</td>"
      +"<td><span class='badge "+gc+"'>"+s2.grp+"</span></td>"
      +"<td style='text-align:right'>"+fmtN(s2.output)+"</td>"
      +"<td style='text-align:right'>"+fmtN(s2.ntb)+"</td>"
      +"<td style='text-align:right'>"+vaPct+"%</td>"
      +"<td style='text-align:right;font-weight:bold;color:"+mc+"'>"+sf(s2.mult,3)+"</td>"
      +"</tr>";
  }
  var totOut = sektor.reduce(function(a,b){return a+b.output;},0);
  var totNTB = sektor.reduce(function(a,b){return a+b.ntb;},0);
  sektorRows += "<tr style='font-weight:bold;background:#f0fdf4'>"
    +"<td colspan='3'>TOTAL</td>"
    +"<td style='text-align:right'>"+fmtN(totOut)+"</td>"
    +"<td style='text-align:right'>"+fmtN(totNTB)+"</td>"
    +"<td style='text-align:right'>"+(totOut>0?(totNTB/totOut*100).toFixed(1):"0")+"%</td>"
    +"<td></td></tr>";

  // TABEL PENGELUARAN
  var komponen = [
    ["Konsumsi Rumah Tangga", makro.C_rt||0],
    ["Konsumsi Pemerintah",   makro.G_gov||0],
    ["PMTB (Investasi)",      makro.I_pmtb||0],
    ["Ekspor",                makro.ekspor||0],
    ["(-) Impor",             -(makro.impor||0)]
  ];
  var penRows = "";
  for (var j=0; j<komponen.length; j++) {
    var kn = komponen[j][0], kv = komponen[j][1];
    var pdrb = makro.PDRB||1;
    penRows += "<tr><td>"+kn+"</td>"
      +"<td style='text-align:right;color:"+(kv<0?"#991b1b":"inherit")+"'>"+fmtN(Math.round(kv))+"</td>"
      +"<td style='text-align:right'>"+(kv/pdrb*100).toFixed(1)+"%</td></tr>";
  }
  penRows += "<tr style='font-weight:bold;background:#f0fdf4'><td>PDRB</td>"
    +"<td style='text-align:right'>"+fmtN(makro.PDRB||0)+"</td>"
    +"<td style='text-align:right'>100,0%</td></tr>";

  // TABEL SAM
  var samLabels = SAM.labels||[];
  var samMatrix = SAM.matrix||[];
  var samHead = "<tr><th>&#x2193; Terima / Bayar &#x2192;</th>";
  for (var k=0; k<samLabels.length; k++) samHead += "<th style='text-align:right'>"+samLabels[k]+"</th>";
  samHead += "</tr>";
  var samRows = "";
  for (var r=0; r<samMatrix.length; r++) {
    samRows += "<tr><td style='font-weight:bold;color:#0f4c81'>"+(samLabels[r]||"")+"</td>";
    var row = samMatrix[r]||[];
    for (var c=0; c<row.length; c++) {
      var v = row[c]||0;
      var vc = v===0?"#cbd5e1":r===c?"#854d0e":"inherit";
      samRows += "<td style='text-align:right;color:"+vc+"'>"+(v===0?"&mdash;":fmtN(Math.round(v)))+"</td>";
    }
    samRows += "</tr>";
  }

  // SAM Multiplier
  var samMult = SAM.mult||[];
  var samMultKPI = ["Produksi","TK","Kapital","RT"].map(function(l,i){
    return kpi("Multiplier "+l, sf(samMult[i]||0,3), "&times;", ["#f97316","#0ea5e9","#f59e0b","#22c55e"][i]);
  }).join("");

  // KETERKAITAN — sektor kunci
  var keySec = sektor.filter(function(x){return x.bl_n>1&&x.fl_n>1;});
  var keyRows = "";
  for (var ki=0; ki<keySec.length; ki++) {
    var ks = keySec[ki];
    keyRows += "<tr><td>"+(ki+1)+"</td><td>"+ks.nama+"</td>"
      +"<td style='text-align:right;color:#166534;font-weight:bold'>"+sf(ks.bl_n,3)+"</td>"
      +"<td style='text-align:right;color:#1e40af;font-weight:bold'>"+sf(ks.fl_n,3)+"</td>"
      +"<td style='text-align:right;font-weight:bold'>"+sf(ks.mult,3)+"</td></tr>";
  }

  // BL & FL top 8
  var sortedBL = sektor.slice().sort(function(a,b){return b.bl_n-a.bl_n;}).slice(0,8);
  var sortedFL = sektor.slice().sort(function(a,b){return b.fl_n-a.fl_n;}).slice(0,8);
  var sortedMult = sektor.slice().sort(function(a,b){return b.mult-a.mult;}).slice(0,8);
  var blRows="",flRows="",multRows="";
  for (var bi=0; bi<sortedBL.length; bi++) {
    var bs=sortedBL[bi];
    blRows+="<tr><td>"+(bi+1)+"</td><td>"+bs.nama.slice(0,28)+"</td><td style='text-align:right;font-weight:bold;color:"+(bs.bl_n>1?"#166534":"#374151")+"'>"+sf(bs.bl_n,3)+"</td></tr>";
  }
  for (var fi=0; fi<sortedFL.length; fi++) {
    var fs=sortedFL[fi];
    flRows+="<tr><td>"+(fi+1)+"</td><td>"+fs.nama.slice(0,28)+"</td><td style='text-align:right;font-weight:bold;color:"+(fs.fl_n>1?"#1e40af":"#374151")+"'>"+sf(fs.fl_n,3)+"</td></tr>";
  }
  for (var mi=0; mi<sortedMult.length; mi++) {
    var ms=sortedMult[mi];
    var gc2=ms.grp==="Industri"?"y":ms.grp==="Pertanian"||ms.grp==="Perikanan"?"g":"b";
    var mc2=ms.mult>=2?"#166534":ms.mult>=1.5?"#854d0e":"#374151";
    multRows+="<tr><td style='text-align:center'>"+(mi+1)+"</td><td>"+ms.nama+"</td>"
      +"<td><span class='badge "+gc2+"'>"+ms.grp+"</span></td>"
      +"<td style='text-align:right;font-weight:bold;color:"+mc2+"'>"+sf(ms.mult,4)+"</td>"
      +"<td>"+(ms.mult>=2.5?"Sangat Tinggi":ms.mult>=2?"Tinggi":ms.mult>=1.5?"Sedang":"Rendah")+"</td></tr>";
  }

  // SECTION CGE
  var cgeHTML = "";
  if (cge && s) {
    var quad = (s.bl_n>1&&s.fl_n>1)?"I &mdash; Kunci"
              :(s.bl_n<=1&&s.fl_n>1)?"II &mdash; Pemimpin"
              :(s.bl_n>1&&s.fl_n<=1)?"III &mdash; Pengikut"
              :"IV &mdash; Independen";
    var impactRows="";
    var impacts=cge.sectorImpact||[];
    for (var ii=0;ii<Math.min(impacts.length,10);ii++) {
      var imp=impacts[ii];
      var igc=imp.grp==="Industri"?"y":imp.grp==="Pertanian"||imp.grp==="Perikanan"?"g":"b";
      impactRows+="<tr><td>"+(ii+1)+"</td><td>"+imp.nama+"</td>"
        +"<td><span class='badge "+igc+"'>"+imp.grp+"</span></td>"
        +"<td style='text-align:right'>"+fmtN(Math.round(imp.dampak||0))+"</td>"
        +"<td style='text-align:right'>"+sf(imp.pct_from_shock||0,1)+"%</td></tr>";
    }
    cgeHTML = ""
      +"<h2 class='sub'>4.1 Konfigurasi Simulasi</h2>"
      +"<div class='shock'>"
      +"<table style='margin:0;border:none'>"
      +"<tr><td style='border:none;color:#1e40af;font-weight:bold;padding:3px 16px 3px 0'>Sektor Target</td><td style='border:none'>"+s.nama+" (Sektor "+s.id+")</td></tr>"
      +"<tr><td style='border:none;color:#1e40af;font-weight:bold;padding:3px 16px 3px 0'>Jenis Kebijakan</td><td style='border:none'>"+stype+"</td></tr>"
      +"<tr><td style='border:none;color:#1e40af;font-weight:bold;padding:3px 16px 3px 0'>Besar Shock</td><td style='border:none'>Rp "+fmtN(amt||0)+" Juta</td></tr>"
      +"<tr><td style='border:none;color:#1e40af;font-weight:bold;padding:3px 16px 3px 0'>Kuadran</td><td style='border:none'>"+quad+"</td></tr>"
      +"<tr><td style='border:none;color:#1e40af;font-weight:bold;padding:3px 16px 3px 0'>Multiplier</td><td style='border:none;font-weight:bold;font-size:14pt;color:#166534'>"+sf(s.mult,3)+"&times;</td></tr>"
      +"</table></div>"
      +"<h2 class='sub'>4.2 Hasil Kuantitatif</h2>"
      +"<div class='kpi-grid'>"
      +kpi("Multiplier Output", sf(s.mult,3), "&times;", "#ec4899")
      +kpi("Total Dampak Output", fmtN(Math.round(cge.total||0)), " Jt Rp", "#22c55e")
      +kpi("Dampak PDRB", "+"+sf(cge.gdpEff,2), "%", "#0ea5e9")
      +kpi("Dampak Pendapatan TK", fmtN(Math.round(cge.incomeEff||0)), " Jt", "#f59e0b")
      +kpi("Konsumsi RT Induced", fmtN(Math.round(cge.consumpEff||0)), " Jt", "#8b5cf6")
      +kpi("Est. Lapangan Kerja", "~"+fmtN(cge.employEff||0), " org", "#f97316")
      +"</div>"
      +"<h2 class='sub'>4.3 Dekomposisi Dampak</h2>"
      +"<table><tr><th>Komponen</th><th style='text-align:right'>Nilai (Juta Rp)</th><th style='text-align:right'>%</th><th>Keterangan</th></tr>"
      +"<tr><td>Efek Langsung</td><td style='text-align:right'>"+fmtN(Math.round(cge.direct||0))+"</td><td style='text-align:right'>"+pct(cge.direct,cge.total)+"%</td><td>Injeksi langsung ke sektor target</td></tr>"
      +"<tr><td>Efek Tidak Langsung</td><td style='text-align:right'>"+fmtN(Math.round((cge.roundOne||0)+(cge.roundTwo||0)))+"</td><td style='text-align:right'>"+pct((cge.roundOne||0)+(cge.roundTwo||0),cge.total)+"%</td><td>Putaran backward ke sektor hulu</td></tr>"
      +"<tr><td>Efek Pendapatan (Induced)</td><td style='text-align:right'>"+fmtN(Math.round(cge.consumpEff||0))+"</td><td style='text-align:right'>"+pct(cge.consumpEff,cge.total)+"%</td><td>Konsumsi RT dari peningkatan upah</td></tr>"
      +"<tr><td style='color:#991b1b'>(-) Kebocoran Impor</td><td style='text-align:right;color:#991b1b'>-"+fmtN(Math.round((cge.shock||0)*0.12))+"</td><td style='text-align:right;color:#991b1b'>-"+pct((cge.shock||0)*0.12,cge.total)+"%</td><td>Dipenuhi impor</td></tr>"
      +"<tr style='font-weight:bold;background:#f0fdf4'><td>Total Dampak Bersih</td><td style='text-align:right'>"+fmtN(Math.round(cge.total||0))+"</td><td style='text-align:right'>100%</td><td>Multiplier "+sf(s.mult,3)+"&times;</td></tr>"
      +"</table>"
      +"<h2 class='sub'>4.4 Distribusi Dampak ke Sektor (Top 10)</h2>"
      +"<table><tr><th>#</th><th>Sektor</th><th>Kelompok</th><th style='text-align:right'>Dampak (Juta Rp)</th><th style='text-align:right'>%</th></tr>"
      +impactRows
      +"</table>"
      +"<h2 class='sub'>4.5 Interpretasi Kebijakan</h2>"
      +"<div class='info'>"
      +"<strong>Posisi Strategis:</strong> Sektor "+s.nama+" berada di Kuadran "+quad
      +" (BL="+sf(s.bl_n,3)+", FL="+sf(s.fl_n,3)+"). "
      +"Setiap Rp 1 Triliun "+stype+" menciptakan Rp "+sf(s.mult,2)+" Triliun output total. "
      +"Dampak terbesar ke: "+(impacts.slice(0,3).map(function(d){return d.nama;}).join(", ") || "-")+"."
      +"</div>"
      +"<ul style='margin:10px 0 0 20px'>"
      +"<li>Estimasi lapangan kerja baru: <strong>~"+fmtN(cge.employEff||0)+" orang</strong></li>"
      +"<li>Penerimaan pajak pemerintah: <strong>Rp "+fmtN(Math.round(cge.govRevEff||0))+" Juta</strong></li>"
      +(s.mult>=2?"<li style='color:#166534'><strong>Rekomendasi:</strong> Sektor ini layak dijadikan prioritas alokasi anggaran.</li>"
               :"<li style='color:#854d0e'><strong>Rekomendasi:</strong> Pertimbangkan penguatan linkage terlebih dahulu.</li>")
      +"</ul>";
  } else {
    cgeHTML = "<div class='warn'>Simulasi belum dijalankan. Buka tab CGE &amp; Simulasi, pilih sektor dan besar shock, lalu klik tombol laporan kembali untuk menyertakan hasil simulasi.</div>";
  }

  // KETENAGAKERJAAN
  var tkSekRows="",tkPddkRows="";
  var tkSek = tk.sektor||[];
  for (var ti=0;ti<tkSek.length;ti++) tkSekRows+="<tr><td>"+tkSek[ti].n+"</td><td style='text-align:right'>"+tkSek[ti].p+"%</td></tr>";
  var tkPddk = tk.pddk||[];
  for (var pi=0;pi<tkPddk.length;pi++) {
    var pd=tkPddk[pi];
    var tc=pd.tpt>5?"#991b1b":pd.tpt>2?"#854d0e":"#166534";
    tkPddkRows+="<tr><td>"+pd.l+"</td><td style='text-align:right'>"+pd.p+"%</td><td style='text-align:right;color:"+tc+"'>"+pd.tpt+"%</td></tr>";
  }

  // RINGKASAN EKSEKUTIF teks
  var ringkasan = "Laporan analisis CGE untuk <strong>"+D.nama+"</strong> tahun <strong>"+D.tahun+"</strong>. "
    +"Tabel I-O 31 sektor dibangun melalui regionalisasi dari "+D.io_ref+" menggunakan metode RAS. ";
  if (cge && s) {
    ringkasan += "Simulasi <strong>"+stype+"</strong> Rp "+fmtN(amt||0)+" Juta pada sektor <strong>"+s.nama
      +"</strong> menghasilkan total dampak <strong>Rp "+fmtN(Math.round(cge.total||0))+" Juta</strong>"
      +" (multiplier "+sf(s.mult,3)+"&times;).";
  }

  var html = "<!DOCTYPE html><html lang='id'><head>"
    +"<meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
    +"<title>Laporan CGE - "+D.nama+" "+D.tahun+"</title>"
    +"<style>"+css+"</style></head><body>"

    // COVER
    +"<div class='cover'>"
    +"<div style='font-size:10pt;color:#64748b;letter-spacing:2px;text-transform:uppercase;margin-bottom:16px'>LAPORAN ANALISIS EKONOMI REGIONAL</div>"
    +"<h1 style='font-size:24pt;color:#1e3a5f;margin-bottom:8px'>Platform CGE Indonesia</h1>"
    +"<h2 style='font-size:16pt;color:#22c55e;margin-bottom:24px'>Computable General Equilibrium</h2>"
    +"<table style='margin:0 auto;font-size:10pt;border-collapse:collapse'>"
    +"<tr><td style='color:#64748b;font-weight:bold;padding:4px 16px 4px 0'>Daerah</td><td><strong>"+D.nama+"</strong></td></tr>"
    +"<tr><td style='color:#64748b;font-weight:bold;padding:4px 16px 4px 0'>Provinsi</td><td>"+D.provinsi+"</td></tr>"
    +"<tr><td style='color:#64748b;font-weight:bold;padding:4px 16px 4px 0'>Tahun Dasar</td><td>"+D.tahun+"</td></tr>"
    +"<tr><td style='color:#64748b;font-weight:bold;padding:4px 16px 4px 0'>I-O Referensi</td><td>"+D.io_ref+"</td></tr>"
    +"<tr><td style='color:#64748b;font-weight:bold;padding:4px 16px 4px 0'>Metode</td><td>Regionalisasi RAS Biproportional Scaling</td></tr>"
    +"<tr><td style='color:#64748b;font-weight:bold;padding:4px 16px 4px 0'>Tanggal Cetak</td><td>"+tgl+"</td></tr>"
    +"</table></div>"

    // RINGKASAN
    +"<h1 class='sec'>Ringkasan Eksekutif</h1>"
    +"<div class='info'>"+ringkasan+"</div>"
    +"<div class='kpi-grid'>"
    +kpi("PDRB Total", sf((makro.PDRB||0)/1e6,2)+" T", " Rp", "#22c55e")
    +kpi("Nilai Tambah Bruto", sf((makro.ntb||0)/1e6,2)+" T", " Rp", "#0ea5e9")
    +kpi("Angkatan Kerja", fmtN(tk.angkatan||0), " org", "#f59e0b")
    +kpi("TPAK", tk.tpak||0, "%", "#f97316")
    +kpi("TPT", tk.tpt||0, "%", "#ef4444")
    +kpi("Rasio Ekspor/PDRB", pct(makro.ekspor||0,makro.PDRB||1), "%", "#8b5cf6")
    +"</div>"

    // BAB 1
    +"<div class='pb'></div>"
    +"<h1 class='sec'>1. Profil Ekonomi Makro</h1>"
    +"<h2 class='sub'>1.1 PDRB Menurut Lapangan Usaha</h2>"
    +"<table><tr><th>#</th><th>Nama Sektor</th><th>Kelompok</th><th>Output (Juta Rp)</th><th>NTB (Juta Rp)</th><th>VA/Output</th><th>Multiplier</th></tr>"
    +sektorRows+"</table>"
    +"<h2 class='sub'>1.2 PDRB Menurut Pengeluaran</h2>"
    +"<table><tr><th>Komponen</th><th style='text-align:right'>Nilai (Juta Rp)</th><th style='text-align:right'>% PDRB</th></tr>"
    +penRows+"</table>"

    // BAB 2
    +"<div class='pb'></div>"
    +"<h1 class='sec'>2. Social Accounting Matrix (SAM)</h1>"
    +"<h2 class='sub'>2.1 Matriks SAM 7&times;7</h2>"
    +"<table>"+samHead+samRows+"</table>"
    +"<h2 class='sub'>2.2 Multiplier SAM</h2>"
    +"<div class='kpi-grid'>"+samMultKPI+"</div>"

    // BAB 3
    +"<div class='pb'></div>"
    +"<h1 class='sec'>3. Analisis Keterkaitan Sektoral</h1>"
    +"<h2 class='sub'>3.1 Sektor Kunci (BL>1 dan FL>1)</h2>"
    +(keySec.length>0
      ?"<p>Terdapat <strong>"+keySec.length+" sektor kunci</strong> dengan BL dan FL di atas rata-rata.</p>"
       +"<table><tr><th>#</th><th>Sektor</th><th>BL Norm</th><th>FL Norm</th><th>Multiplier</th></tr>"+keyRows+"</table>"
      :"<div class='warn'>Tidak ditemukan sektor kunci. Pertimbangkan penguatan keterkaitan antar sektor.</div>")
    +"<div class='two'>"
    +"<div><h2 class='sub'>3.2 Top Backward Linkage</h2>"
    +"<table><tr><th>#</th><th>Sektor</th><th>BL Norm</th></tr>"+blRows+"</table></div>"
    +"<div><h2 class='sub'>3.3 Top Forward Linkage</h2>"
    +"<table><tr><th>#</th><th>Sektor</th><th>FL Norm</th></tr>"+flRows+"</table></div>"
    +"</div>"
    +"<h2 class='sub'>3.4 Ranking Multiplier Output (Top 8)</h2>"
    +"<table><tr><th>Rank</th><th>Sektor</th><th>Kelompok</th><th>Multiplier</th><th>Klasifikasi</th></tr>"+multRows+"</table>"

    // BAB 4
    +"<div class='pb'></div>"
    +"<h1 class='sec'>4. Hasil Simulasi CGE</h1>"
    +cgeHTML

    // BAB 5
    +"<div class='pb'></div>"
    +"<h1 class='sec'>5. Profil Ketenagakerjaan</h1>"
    +"<table><tr><th>Indikator</th><th style='text-align:right'>Nilai</th><th>Keterangan</th></tr>"
    +"<tr><td>Penduduk Usia Kerja</td><td style='text-align:right'>"+fmtN(tk.puk||0)+"</td><td>Usia 15+</td></tr>"
    +"<tr><td>Angkatan Kerja</td><td style='text-align:right'>"+fmtN(tk.angkatan||0)+"</td><td>"+sf(tk.tpak,2)+"% dari PUK</td></tr>"
    +"<tr><td>Bekerja</td><td style='text-align:right'>"+fmtN(tk.bekerja||0)+"</td><td>TKK: "+sf(tk.tkk,2)+"%</td></tr>"
    +"<tr><td>Pengangguran</td><td style='text-align:right'>"+fmtN(tk.pengangguran||0)+"</td><td>TPT: "+sf(tk.tpt,2)+"%</td></tr>"
    +"<tr><td>Sektor Formal</td><td style='text-align:right'>"+sf(tk.formal,1)+"%</td><td>Informal: "+sf(tk.informal,1)+"%</td></tr>"
    +"</table>"
    +"<div class='two'>"
    +"<div><h2 class='sub'>Distribusi Lapangan Kerja</h2>"
    +"<table><tr><th>Sektor</th><th style='text-align:right'>%</th></tr>"+tkSekRows+"</table></div>"
    +"<div><h2 class='sub'>TPT per Pendidikan</h2>"
    +"<table><tr><th>Pendidikan</th><th style='text-align:right'>% Pekerja</th><th style='text-align:right'>TPT</th></tr>"+tkPddkRows+"</table></div>"
    +"</div>"

    // BAB 6
    +"<div class='pb'></div>"
    +"<h1 class='sec'>6. Catatan Metodologi</h1>"
    +"<p>Tabel I-O dibangun melalui <strong>regionalisasi RAS biproportional scaling</strong> dari "
    +D.io_ref+". SAM 7&times;7 dari PDRB pengeluaran, APBD, dan Sakernas.</p>"
    +"<table><tr><th>Parameter</th><th>Nilai</th><th>Sumber</th></tr>"
    +"<tr><td>Elastisitas Armington (&sigma;)</td><td>2,0</td><td>Oktaviani (2008)</td></tr>"
    +"<tr><td>Elastisitas CET (&sigma;)</td><td>2,5</td><td>Oktaviani (2008)</td></tr>"
    +"<tr><td>Elastisitas Penawaran TK (&eta;)</td><td>0,8</td><td>BPS/ILO Indonesia</td></tr>"
    +"<tr><td>MPC Rumah Tangga</td><td>0,68</td><td>Susenas Jawa Tengah</td></tr>"
    +"</table>"
    +"<div class='warn'><strong>Catatan:</strong> Hasil bersifat indikatif berbasis model statis Leontief. "
    +"Gunakan untuk analisis komparatif dan prioritas kebijakan, bukan proyeksi presisi.</div>"
    +"<div class='foot'>Laporan dihasilkan oleh Platform CGE Indonesia v2.0 &middot; "+tgl
    +"<br>Metodologi: Regionalisasi RAS &middot; Matriks Leontief &middot; SAM 7&times;7</div>"
    +"<button class='noprint' onclick='window.print()' "
    +"style='position:fixed;bottom:24px;right:24px;padding:12px 24px;background:#22c55e;"
    +"color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.3)'>"
    +"&#128424; Print / Save PDF</button>"
    +"</body></html>";

  return html;
}



// ─────────────────────────────────────────────
// DATA REMBANG 2016
// ─────────────────────────────────────────────
const REMBANG = {
  nama:"Kabupaten Rembang", provinsi:"Jawa Tengah", tahun:2016,
  io_ref:"Tabel I-O Kab. Jepara 2016 — Regionalisasi RAS",
  sektor:[
    {id:1,  nama:"Padi",                       output:1009004, ntb:875186, upah:208660, bl:1.160,fl:1.756,bl_n:0.638,fl_n:0.966,mult:1.160,grp:"Pertanian"},
    {id:2,  nama:"Umbi-Umbian",                output:235809,  ntb:210391, upah:50188,  bl:1.375,fl:1.337,bl_n:0.756,fl_n:0.735,mult:1.375,grp:"Pertanian"},
    {id:3,  nama:"Bahan Makanan Lainnya",       output:39346,   ntb:35112,  upah:8378,   bl:3.306,fl:1.487,bl_n:1.818,fl_n:0.818,mult:3.306,grp:"Pertanian"},
    {id:4,  nama:"Sayuran",                     output:45008,   ntb:39706,  upah:9472,   bl:2.651,fl:1.051,bl_n:1.457,fl_n:0.578,mult:2.651,grp:"Pertanian"},
    {id:5,  nama:"Buah-buahan",                 output:994116,  ntb:902519, upah:215320, bl:1.139,fl:1.391,bl_n:0.626,fl_n:0.765,mult:1.139,grp:"Pertanian"},
    {id:6,  nama:"Tebu",                        output:129233,  ntb:99465,  upah:23731,  bl:1.726,fl:1.038,bl_n:0.949,fl_n:0.571,mult:1.726,grp:"Pertanian"},
    {id:7,  nama:"Kelapa",                      output:176083,  ntb:151587, upah:36173,  bl:1.496,fl:1.330,bl_n:0.823,fl_n:0.731,mult:1.496,grp:"Pertanian"},
    {id:8,  nama:"Hasil Perkebunan Lainnya",    output:809692,  ntb:690181, upah:164643, bl:1.172,fl:2.940,bl_n:0.644,fl_n:1.616,mult:1.172,grp:"Pertanian"},
    {id:9,  nama:"Jasa Pertanian",              output:100423,  ntb:70679,  upah:16867,  bl:1.864,fl:1.358,bl_n:1.025,fl_n:0.747,mult:1.864,grp:"Pertanian"},
    {id:10, nama:"Ternak & Hasil-hasilnya",     output:177368,  ntb:111186, upah:26528,  bl:1.888,fl:1.714,bl_n:1.038,fl_n:0.943,mult:1.888,grp:"Pertanian"},
    {id:11, nama:"Unggas & Hasil-hasilnya",     output:177076,  ntb:107132, upah:25563,  bl:1.999,fl:1.315,bl_n:1.099,fl_n:0.723,mult:1.999,grp:"Pertanian"},
    {id:12, nama:"Kayu & Hasil Hutan",          output:132287,  ntb:110929, upah:26467,  bl:1.609,fl:1.614,bl_n:0.885,fl_n:0.888,mult:1.609,grp:"Pertanian"},
    {id:13, nama:"Ikan Laut & Hasil Laut",      output:156004,  ntb:134296, upah:32040,  bl:1.492,fl:1.065,bl_n:0.820,fl_n:0.586,mult:1.492,grp:"Perikanan"},
    {id:14, nama:"Ikan Darat & Perairan",       output:123157,  ntb:105012, upah:25055,  bl:1.749,fl:1.084,bl_n:0.962,fl_n:0.596,mult:1.749,grp:"Perikanan"},
    {id:15, nama:"Pertambangan & Penggalian",   output:466796,  ntb:383627, upah:91538,  bl:1.283,fl:5.936,bl_n:0.706,fl_n:3.264,mult:1.283,grp:"Pertambangan"},
    {id:16, nama:"Industri Makanan & Minuman",  output:2373321, ntb:724456, upah:172825, bl:1.777,fl:3.876,bl_n:0.977,fl_n:2.131,mult:1.777,grp:"Industri"},
    {id:17, nama:"Pengolahan Tembakau",         output:354004,  ntb:213562, upah:50959,  bl:1.525,fl:1.189,bl_n:0.839,fl_n:0.654,mult:1.525,grp:"Industri"},
    {id:18, nama:"Industri Tekstil & Pakaian",  output:63983,   ntb:24255,  upah:5787,   bl:2.821,fl:1.366,bl_n:1.551,fl_n:0.751,mult:2.821,grp:"Industri"},
    {id:19, nama:"Industri Kayu & Mebel",       output:234117,  ntb:88739,  upah:21176,  bl:2.085,fl:1.356,bl_n:1.147,fl_n:0.745,mult:2.085,grp:"Industri"},
    {id:20, nama:"Industri Mineral Non Logam",  output:79044,   ntb:34302,  upah:8185,   bl:2.197,fl:1.146,bl_n:1.208,fl_n:0.630,mult:2.197,grp:"Industri"},
    {id:21, nama:"Industri Barang Lainnya",     output:114706,  ntb:39428,  upah:9408,   bl:1.887,fl:1.369,bl_n:1.038,fl_n:0.753,mult:1.887,grp:"Industri"},
    {id:22, nama:"Listrik, Gas & Air",          output:16763,   ntb:2415,   upah:576,    bl:4.704,fl:1.039,bl_n:2.587,fl_n:0.571,mult:4.704,grp:"Utilitas"},
    {id:23, nama:"Konstruksi",                  output:1115264, ntb:371068, upah:88534,  bl:1.580,fl:1.888,bl_n:0.869,fl_n:1.038,mult:1.580,grp:"Konstruksi"},
    {id:24, nama:"Perdagangan",                 output:1913729, ntb:1305447,upah:311525, bl:1.406,fl:4.851,bl_n:0.773,fl_n:2.667,mult:1.406,grp:"Jasa"},
    {id:25, nama:"Hotel & Rumah Makan",         output:454940,  ntb:208213, upah:49678,  bl:1.888,fl:1.459,bl_n:1.038,fl_n:0.802,mult:1.888,grp:"Jasa"},
    {id:26, nama:"Transportasi",                output:526760,  ntb:221212, upah:52773,  bl:1.474,fl:2.458,bl_n:0.810,fl_n:1.352,mult:1.474,grp:"Jasa"},
    {id:27, nama:"Informasi & Komunikasi",      output:154072,  ntb:99898,  upah:23836,  bl:1.883,fl:1.255,bl_n:1.035,fl_n:0.690,mult:1.883,grp:"Jasa"},
    {id:28, nama:"Lembaga Keuangan & Jasa",     output:813408,  ntb:602901, upah:143840, bl:1.431,fl:2.365,bl_n:0.787,fl_n:1.300,mult:1.431,grp:"Jasa"},
    {id:29, nama:"Pemerintahan & Pertahanan",   output:567661,  ntb:350262, upah:83557,  bl:1.512,fl:1.108,bl_n:0.831,fl_n:0.609,mult:1.512,grp:"Jasa"},
    {id:30, nama:"Jasa-Jasa Lainnya",           output:1318516, ntb:740922, upah:176767, bl:1.298,fl:2.234,bl_n:0.714,fl_n:1.228,mult:1.298,grp:"Jasa"},
  ],
  makro:{PDRB:14871689,C_rt:10426704,G_gov:1432361,I_pmtb:3223010,ekspor:3951248,impor:4524123,ntb:9038081,upah:2849905,surplus:5887642},
  SAM:{
    labels:["Produksi","TK","Kapital","RT","Pemerintah","Investasi","ROW"],
    matrix:[
      [5025915,0,0,10426704,1432361,3364529,3951248],
      [2849905,0,0,0,0,0,0],
      [5887642,0,0,0,0,0,0],
      [0,2849905,4121350,0,3943437,0,0],
      [180762,0,176629,139425,0,0,0],
      [0,0,1589663,348563,182488,0,572876],
      [4524123,0,0,0,0,0,0],
    ],
    mult:[3.30,4.30,4.30,3.75]
  },
  tk:{
    puk:522595,angkatan:380165,bekerja:370269,pengangguran:9896,
    tpak:72.75,tpt:2.60,tkk:97.40,formal:42.44,informal:57.57,
    sektor:[{n:"Pertanian",p:32.65},{n:"Industri",p:12.74},{n:"Perdagangan",p:15.69},{n:"Jasa",p:13.07},{n:"Lainnya",p:25.85}],
    pddk:[{l:"≤SD",p:45.88,tpt:2.12},{l:"SMP",p:22.42,tpt:1.49},{l:"SMA",p:15.29,tpt:2.98},{l:"SMK",p:6.37,tpt:12.01},{l:"D3",p:1.78,tpt:0.0},{l:"S1+",p:8.26,tpt:0.0}],
    tpak_g:[{g:"Laki-laki",v:87.26},{g:"Perempuan",v:58.22}],
    tpt_g:[{g:"Laki-laki",v:2.65},{g:"Perempuan",v:2.53}],
    status:[{s:"Buruh/Kary.",p:37.84},{s:"Usaha Sendiri",p:18.19},{s:"Pekerja Klg",p:13.85},{s:"Usaha+BuTT",p:15.00},{s:"Usaha+BuT",p:4.60},{s:"Pekerja Bebas",p:10.53}],
  }
};

// ─────────────────────────────────────────────
// WIZARD TEMPLATE DAERAH BARU
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// MATRIKS TRANSAKSI I-O REMBANG 2016 (30×30)
// Hasil Regionalisasi RAS dari I-O Kab. Jepara 2016
// Satuan: Juta Rupiah (ADHP)
// ─────────────────────────────────────────────
const IO_MATRIX = {
  names: ["Padi","Umbi-Umbian","Bahan Makanan Lainnya","Sayuran","Buah-buahan","Tebu","Kelapa","Hasil Perkebunan dan Pertanian Lainnya","Jasa Pertanian","Ternak dan Hasil-hasilnya","Unggas dan Hasil-hasilnya","Kayu dan Hasil Hutan Lainnya","Ikan Laut dan Hasil Laut Lainnya","Ikan Darat dan Hasil Perairan Darat","Pertambangan dan Penggalian","Industri Makanan dan Minuman","Pengolahan Tembakau","Industri Tekstil dan Pakaian Jadi","Industri Barang Kayu dan Mebel","Industri Mineral Non Logam","Industri Barang Lainnya","Listrik, Gas dan Air Minum","Bangunan","Perdagangan","Hotel dan Rumah Makan","Angkutan","Informasi dan Komunikasi","Lembaga Keuangan, Persewaan dan Jasa Perusahaan","Pemerintahan Umum dan Pertahanan","Jasa-Jasa Lainnya"],
  Z: [[82283,0,0,0,0,0,0,0,10609,11266,138,0,0,0,0,216001,0,0,0,440,5,0,0,56,0,0,0,0,65,163],[0,44068,0,0,0,0,0,0,204,4103,254,0,0,144,0,18502,0,0,0,0,0,0,0,0,2099,71,0,0,1950,326],[0,0,10973,91,0,0,0,0,887,932,419,0,0,690,0,23746,72,0,0,0,0,0,0,0,268,1,0,0,136,53],[0,0,0,2162,0,0,0,0,0,31,1,0,0,0,0,108,0,0,0,0,0,0,0,0,57,0,0,0,65,75],[0,0,0,2399,61640,0,0,0,0,3833,0,0,0,0,0,34537,0,0,0,0,152,0,0,971,28614,0,0,0,13535,19481],[0,0,0,0,0,2406,0,0,0,88,0,0,0,0,0,11013,0,0,0,0,0,0,0,0,2,0,0,0,0,0],[0,0,0,0,328,0,10872,0,0,0,0,0,0,0,0,150050,0,0,9,0,134,0,0,65,163,4,0,0,58,32],[72,102,328,0,0,0,1000,76141,393,2771,0,0,0,0,0,161538,76313,24916,10779,12,39796,0,0,13,1182,22,0,0,929,8943],[9625,2661,6561,785,319,344,673,807,0,900,189,2702,575,150,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[8327,4173,6800,7814,11117,7,115,1904,14107,869,0,0,0,0,0,7362,0,9,0,0,8,0,0,0,354,34,0,0,118,133],[0,272,259,7164,9207,0,0,1622,0,552,1957,0,20,185,0,3387,0,0,0,0,37,0,0,0,26252,10,0,0,1138,2079],[39,31,246,7,19,358,656,810,0,360,0,13090,1386,154,908,2253,0,0,50386,565,326,0,56904,94,313,0,0,22,26,1826],[0,0,0,0,0,0,0,30,0,0,0,0,3617,0,0,21551,0,0,0,0,7,0,0,0,1407,5,0,0,189,164],[0,0,0,0,0,0,0,0,32,0,0,0,87,8394,0,3339,0,0,0,0,1,0,0,0,971,4,0,21,107,259],[0,0,0,0,0,0,0,1,0,19,0,0,0,0,45786,105479,15,8455,1024,39257,22396,45526,124737,202,3013,0,0,0,19777,44412],[0,0,0,0,0,0,0,4355,7199,56542,86260,0,9844,30297,0,381335,167,1964,742,14,5914,0,0,2213,121472,2628,145,4776,17117,26725],[0,0,0,0,0,0,0,76,0,0,0,0,0,0,0,0,37992,0,0,0,0,0,0,0,18033,713,0,90,0,0],[56,81,82,683,407,231,160,464,78,10,0,206,21,6,191,272,0,14296,309,22,170,0,205,5665,677,247,71,375,605,2276],[0,22,63,419,988,0,53,620,188,1,18,0,599,60,1675,582,5,55,36126,228,149,0,44387,6495,25,33,30,70,303,756],[0,0,0,0,0,0,0,9,2,12,1,2,0,1,0,339,0,0,386,6737,115,0,20678,2050,47,48,19,193,755,818],[1160,320,958,1743,697,2036,716,1245,1557,88,99,1358,2910,303,1296,1907,724,945,591,1125,686,291,10829,7040,228,7903,941,1360,3036,11940],[0,0,0,0,0,3,7,10,43,45,30,25,12,68,8,331,35,331,114,180,38,125,44,3138,137,125,691,355,371,766],[2033,42,1908,961,93,22286,6086,2747,306,221,11,4007,982,709,8736,365,14,230,62,841,64,84,1018,28046,280,1552,8824,57010,13879,3543],[8766,5353,8225,14131,12292,10533,29829,9279,6733,9806,10223,16964,21477,9986,19656,55484,7431,11851,40064,7572,4616,1247,108520,78069,23709,57599,6513,23699,30303,59097],[0,27,1070,433,258,162,992,200,779,36,9,643,1437,326,2797,1510,2172,1158,662,397,507,15,8475,48385,4283,2895,1648,12916,26569,7992],[2550,3154,3994,3809,2683,10297,2764,2678,2446,2514,1561,6842,4326,1602,3928,12537,6261,3619,10953,4323,1595,182,16351,104230,3998,18158,7550,13049,23479,13486],[0,0,1,87,41,15,9,38,0,8,2,47,9,0,62,760,48,143,101,531,153,5,1047,18321,866,2176,18689,4886,1183,3490],[4167,197,1393,604,610,10356,2112,2878,2248,1325,98,2511,1386,745,2949,9236,4752,2069,1862,1220,652,212,17094,144833,3022,10206,24094,75174,8842,24235],[0,0,0,0,66,727,0,119,0,100,6,0,344,45,82,208,62,112,81,108,143,6,1758,0,1420,652,2187,16546,4257,3037],[3380,591,1109,35,76,1942,3819,1003,7192,1500,130,4619,67,52,6589,14138,4398,960,1735,1906,795,22,9675,52843,1669,70805,15483,21186,22908,32189]],
  A: [[0.0815,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.1056,0.0635,0.0008,0.0,0.0,0.0,0.0,0.091,0.0,0.0,0.0,0.0056,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0001,0.0001],[0.0,0.1869,0.0,0.0,0.0,0.0,0.0,0.0,0.002,0.0231,0.0014,0.0,0.0,0.0012,0.0,0.0078,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0046,0.0001,0.0,0.0,0.0034,0.0002],[0.0,0.0,0.2789,0.002,0.0,0.0,0.0,0.0,0.0088,0.0053,0.0024,0.0,0.0,0.0056,0.0,0.01,0.0002,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0006,0.0,0.0,0.0,0.0002,0.0],[0.0,0.0,0.0,0.048,0.0,0.0,0.0,0.0,0.0,0.0002,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0001,0.0,0.0,0.0,0.0001,0.0001],[0.0,0.0,0.0,0.0533,0.062,0.0,0.0,0.0,0.0,0.0216,0.0,0.0,0.0,0.0,0.0,0.0146,0.0,0.0,0.0,0.0,0.0013,0.0,0.0,0.0005,0.0629,0.0,0.0,0.0,0.0238,0.0148],[0.0,0.0,0.0,0.0,0.0,0.0186,0.0,0.0,0.0,0.0005,0.0,0.0,0.0,0.0,0.0,0.0046,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],[0.0,0.0,0.0,0.0,0.0003,0.0,0.0617,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0632,0.0,0.0,0.0,0.0,0.0012,0.0,0.0,0.0,0.0004,0.0,0.0,0.0,0.0001,0.0],[0.0001,0.0004,0.0083,0.0,0.0,0.0,0.0057,0.094,0.0039,0.0156,0.0,0.0,0.0,0.0,0.0,0.0681,0.2156,0.3894,0.046,0.0001,0.3469,0.0,0.0,0.0,0.0026,0.0,0.0,0.0,0.0016,0.0068],[0.0095,0.0113,0.1668,0.0174,0.0003,0.0027,0.0038,0.001,0.0,0.0051,0.0011,0.0204,0.0037,0.0012,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],[0.0083,0.0177,0.1728,0.1736,0.0112,0.0001,0.0007,0.0024,0.1405,0.0049,0.0,0.0,0.0,0.0,0.0,0.0031,0.0,0.0001,0.0,0.0,0.0001,0.0,0.0,0.0,0.0008,0.0001,0.0,0.0,0.0002,0.0001],[0.0,0.0012,0.0066,0.1592,0.0093,0.0,0.0,0.002,0.0,0.0031,0.0111,0.0,0.0001,0.0015,0.0,0.0014,0.0,0.0,0.0,0.0,0.0003,0.0,0.0,0.0,0.0577,0.0,0.0,0.0,0.002,0.0016],[0.0,0.0001,0.0062,0.0002,0.0,0.0028,0.0037,0.001,0.0,0.002,0.0,0.099,0.0089,0.0012,0.0019,0.0009,0.0,0.0,0.2152,0.0072,0.0028,0.0,0.051,0.0,0.0007,0.0,0.0,0.0,0.0,0.0014],[0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0232,0.0,0.0,0.0091,0.0,0.0,0.0,0.0,0.0001,0.0,0.0,0.0,0.0031,0.0,0.0,0.0,0.0003,0.0001],[0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0003,0.0,0.0,0.0,0.0006,0.0682,0.0,0.0014,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0021,0.0,0.0,0.0,0.0002,0.0002],[0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0001,0.0,0.0,0.0,0.0,0.0981,0.0444,0.0,0.1321,0.0044,0.4966,0.1952,2.7158,0.1118,0.0001,0.0066,0.0,0.0,0.0,0.0348,0.0337],[0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0054,0.0717,0.3188,0.4871,0.0,0.0631,0.246,0.0,0.1607,0.0005,0.0307,0.0032,0.0002,0.0516,0.0,0.0,0.0012,0.267,0.005,0.0009,0.0059,0.0302,0.0203],[0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0001,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.1073,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0396,0.0014,0.0,0.0001,0.0,0.0],[0.0001,0.0003,0.0021,0.0152,0.0004,0.0018,0.0009,0.0006,0.0008,0.0001,0.0,0.0016,0.0001,0.0,0.0004,0.0001,0.0,0.2234,0.0013,0.0003,0.0015,0.0,0.0002,0.003,0.0015,0.0005,0.0005,0.0005,0.0011,0.0017],[0.0,0.0001,0.0016,0.0093,0.001,0.0,0.0003,0.0008,0.0019,0.0,0.0001,0.0,0.0038,0.0005,0.0036,0.0002,0.0,0.0009,0.1543,0.0029,0.0013,0.0,0.0398,0.0034,0.0001,0.0001,0.0002,0.0001,0.0005,0.0006],[0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0001,0.0,0.0,0.0,0.0,0.0,0.0001,0.0,0.0,0.0016,0.0852,0.001,0.0,0.0185,0.0011,0.0001,0.0001,0.0001,0.0002,0.0013,0.0006],[0.0011,0.0014,0.0243,0.0387,0.0007,0.0158,0.0041,0.0015,0.0155,0.0005,0.0006,0.0103,0.0187,0.0025,0.0028,0.0008,0.002,0.0148,0.0025,0.0142,0.006,0.0174,0.0097,0.0037,0.0005,0.015,0.0061,0.0017,0.0053,0.0091],[0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0004,0.0003,0.0002,0.0002,0.0001,0.0006,0.0,0.0001,0.0001,0.0052,0.0005,0.0023,0.0003,0.0074,0.0,0.0016,0.0003,0.0002,0.0045,0.0004,0.0007,0.0006],[0.002,0.0002,0.0485,0.0214,0.0001,0.1724,0.0346,0.0034,0.003,0.0012,0.0001,0.0303,0.0063,0.0058,0.0187,0.0002,0.0,0.0036,0.0003,0.0106,0.0006,0.005,0.0009,0.0147,0.0006,0.0029,0.0573,0.0701,0.0245,0.0027],[0.0087,0.0227,0.2091,0.314,0.0124,0.0815,0.1694,0.0115,0.067,0.0553,0.0577,0.1282,0.1377,0.0811,0.0421,0.0234,0.021,0.1852,0.1711,0.0958,0.0402,0.0744,0.0973,0.0408,0.0521,0.1093,0.0423,0.0291,0.0534,0.0448],[0.0,0.0001,0.0272,0.0096,0.0003,0.0013,0.0056,0.0002,0.0078,0.0002,0.0001,0.0049,0.0092,0.0026,0.006,0.0006,0.0061,0.0181,0.0028,0.005,0.0044,0.0009,0.0076,0.0253,0.0094,0.0055,0.0107,0.0159,0.0468,0.0061],[0.0025,0.0134,0.1015,0.0846,0.0027,0.0797,0.0157,0.0033,0.0244,0.0142,0.0088,0.0517,0.0277,0.013,0.0084,0.0053,0.0177,0.0566,0.0468,0.0547,0.0139,0.0108,0.0147,0.0545,0.0088,0.0345,0.049,0.016,0.0414,0.0102],[0.0,0.0,0.0,0.0019,0.0,0.0001,0.0001,0.0,0.0,0.0,0.0,0.0004,0.0001,0.0,0.0001,0.0003,0.0001,0.0022,0.0004,0.0067,0.0013,0.0003,0.0009,0.0096,0.0019,0.0041,0.1213,0.006,0.0021,0.0026],[0.0041,0.0008,0.0354,0.0134,0.0006,0.0801,0.012,0.0036,0.0224,0.0075,0.0006,0.019,0.0089,0.006,0.0063,0.0039,0.0134,0.0323,0.008,0.0154,0.0057,0.0126,0.0153,0.0757,0.0066,0.0194,0.1564,0.0924,0.0156,0.0184],[0.0,0.0,0.0,0.0,0.0001,0.0056,0.0,0.0001,0.0,0.0006,0.0,0.0,0.0022,0.0004,0.0002,0.0001,0.0002,0.0018,0.0003,0.0014,0.0012,0.0004,0.0016,0.0,0.0031,0.0012,0.0142,0.0203,0.0075,0.0023],[0.0033,0.0025,0.0282,0.0008,0.0001,0.015,0.0217,0.0012,0.0716,0.0085,0.0007,0.0349,0.0004,0.0004,0.0141,0.006,0.0124,0.015,0.0074,0.0241,0.0069,0.0013,0.0087,0.0276,0.0037,0.1344,0.1005,0.026,0.0404,0.0244]],
  X: [1009004,235809,39346,45008,994116,129233,176083,809692,100423,177368,177076,132287,156004,123157,466796,2373321,354004,63983,234117,79044,114706,16763,1115264,1913729,454940,526760,154072,813408,567661,1318516],
  VA: [875600,210176,35094,39689,902655,99551,151564,689996,70687,111197,107125,110883,134347,105024,383664,724887,213503,24259,88546,34304,39387,2413,371036,1304620,208072,221316,99879,603126,350583,724897],
  W:  [184427,33854,5619,8075,125572,26585,35684,212505,18510,42045,37958,25408,28488,17649,129803,183804,33155,6578,23883,11915,11487,1235,141422,375775,72033,77514,26574,129152,311924,511272],
  S:  [691172,176321,29475,31614,777083,72966,115879,477491,52177,69152,69167,85475,105859,87376,253861,541082,180348,17682,64664,22389,27900,1178,229614,928846,136039,143803,73305,473974,38659,213625],
};

// Data Kuadran 2 & 3
const IO_Q2Q3 = {
  C:   [728571,173769,1143,45018,877865,122553,15214,428304,78506,120852,130189,1595,136647,116428,7093,1708820,314630,38247,148436,49595,51546,10307,1004279,1275783,345436,245520,107336,479018,567195,1096811],
  G:   [100087,23871,157,6184,120596,16836,2090,58838,10785,16602,17885,219,18772,15994,974,234748,43222,5254,20391,6813,7081,1416,137962,175260,47454,33728,14745,65805,77918,150674],
  I:   [235098,56073,369,14527,283273,39546,4909,138207,25332,38997,42010,515,44094,37569,2289,551409,101526,12342,47898,16003,16633,3326,324065,411675,111466,79225,34636,154571,183025,353923],
  E:   [276095,65851,433,17060,332671,46442,5765,162308,29750,45797,49336,605,51783,44121,2688,647565,119230,14494,56250,18794,19534,3906,380576,483464,130904,93041,40675,181526,214941,415642],
  FA:  [687978,164088,1079,42510,828954,115725,14366,404440,74132,114119,122935,1506,129034,109941,6698,1613612,297100,36116,140165,46832,48674,9733,948325,1204702,326189,231841,101356,452330,535593,1035702],
  M:   [306950,71736,11970,13692,302420,39314,53566,246317,30550,53957,53868,40243,47458,37466,142004,721989,107692,19464,71221,24046,34895,5100,339275,582176,138397,160246,46870,247447,172688,401106],
  W:   [184427,33854,5619,8075,125572,26585,35684,212505,18510,42045,37958,25408,28488,17649,129803,183804,33155,6578,23883,11915,11487,1235,141422,375775,72033,77514,26574,129152,311924,511272],
  S:   [692842,174895,28419,31272,768675,72159,114049,467763,51686,68312,68413,84136,104910,86741,248143,461019,68260,15620,61572,19829,22189,4212,209474,916024,131424,142617,68989,458147,38659,207191],
  tax: [-1669,1426,1055,343,8408,807,1830,9728,491,840,754,1338,949,635,5718,80064,112088,2062,3091,2560,5710,-3034,20139,12821,4615,1186,4316,15826,0,6433],
  VA:  [875600,210176,35094,39689,902655,99551,151564,689996,70687,111197,107125,110883,134347,105024,383664,724887,213503,24259,88546,34304,39387,2413,371036,1304620,208072,221316,99879,603126,350583,724897],
  X:   [1009004,235809,39346,45008,994116,129233,176083,809692,100423,177368,177076,132287,156004,123157,466796,2373321,354004,63983,234117,79044,114706,16763,1115264,1913729,454940,526760,154072,813408,567661,1318516],
};


// ─────────────────────────────────────────────
// DATA PARAMETER LES (Linear Expenditure System)
// Stone-Geary Utility Function — Rembang 2016
// Estimasi dari data Susenas/PDRB Pengeluaran
// ─────────────────────────────────────────────
const LES_PARAMS = [{"nama":"Makanan & Minuman","share":0.465,"eta_i":0.72,"C_i":4848417,"gamma_i":3050673,"beta_i":0.3448,"c_check":4848417},{"nama":"Pakaian & Sandang","share":0.041,"eta_i":1.05,"C_i":427495,"gamma_i":196333,"beta_i":0.0443,"c_check":427495},{"nama":"Perumahan & Fasilitas","share":0.093,"eta_i":0.85,"C_i":969683,"gamma_i":545216,"beta_i":0.0814,"c_check":969683},{"nama":"Kesehatan & Pddk","share":0.057,"eta_i":1.2,"C_i":594322,"gamma_i":227041,"beta_i":0.0705,"c_check":594322},{"nama":"Transportasi","share":0.254,"eta_i":1.35,"C_i":2648383,"gamma_i":807144,"beta_i":0.3532,"c_check":2648383},{"nama":"Hotel & Resto","share":0.074,"eta_i":1.15,"C_i":771576,"gamma_i":314622,"beta_i":0.0877,"c_check":771576},{"nama":"Lainnya","share":0.016,"eta_i":1.1,"C_i":166827,"gamma_i":72322,"beta_i":0.0181,"c_check":166827}];

// Bobot IHK per kelompok komoditas (dari Susenas Jawa Tengah)
const LES_BASE = {
  Y0: 10426704,
  totalGamma: 5213352,
  supernumerary: 5213352,
};

const IHK_WEIGHTS = [
  {nama:"Makanan & Minuman",    w:0.465, sektor:["Pertanian","Perikanan","Industri"]},
  {nama:"Pakaian & Sandang",    w:0.041, sektor:["Industri"]},
  {nama:"Perumahan & Fasil.",   w:0.093, sektor:["Konstruksi","Utilitas"]},
  {nama:"Kesehatan & Pddk",     w:0.057, sektor:["Jasa"]},
  {nama:"Transportasi",         w:0.254, sektor:["Jasa","Pertambangan"]},
  {nama:"Hotel & Resto",        w:0.074, sektor:["Jasa"]},
  {nama:"Lainnya",              w:0.016, sektor:["Jasa"]},
];

// Bobot IHP per kelompok sektor produsen
const IHP_WEIGHTS_MAP = {
  Pertanian: 0.22, Perikanan: 0.03, Pertambangan: 0.05,
  Industri: 0.24, Utilitas: 0.02, Konstruksi: 0.10, Jasa: 0.34,
};



// ─────────────────────────────────────────────
// DATA ANALISIS STRUKTURAL — Matriks A original
// Hasil regionalisasi RAS dari I-O Jepara 2016
// ─────────────────────────────────────────────
const STRUCT = {
  A_orig: [[0.0815,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.1056,0.0635,0.0008,0.0,0.0,0.0,0.0,0.091,0.0,0.0,0.0,0.0056,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0001,0.0001],[0.0,0.1869,0.0,0.0,0.0,0.0,0.0,0.0,0.002,0.0231,0.0014,0.0,0.0,0.0012,0.0,0.0078,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0046,0.0001,0.0,0.0,0.0034,0.0002],[0.0,0.0,0.2789,0.002,0.0,0.0,0.0,0.0,0.0088,0.0053,0.0024,0.0,0.0,0.0056,0.0,0.01,0.0002,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0006,0.0,0.0,0.0,0.0002,0.0],[0.0,0.0,0.0,0.048,0.0,0.0,0.0,0.0,0.0,0.0002,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0001,0.0,0.0,0.0,0.0001,0.0001],[0.0,0.0,0.0,0.0533,0.062,0.0,0.0,0.0,0.0,0.0216,0.0,0.0,0.0,0.0,0.0,0.0146,0.0,0.0,0.0,0.0,0.0013,0.0,0.0,0.0005,0.0629,0.0,0.0,0.0,0.0238,0.0148],[0.0,0.0,0.0,0.0,0.0,0.0186,0.0,0.0,0.0,0.0005,0.0,0.0,0.0,0.0,0.0,0.0046,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],[0.0,0.0,0.0,0.0,0.0003,0.0,0.0617,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0632,0.0,0.0,0.0,0.0,0.0012,0.0,0.0,0.0,0.0004,0.0,0.0,0.0,0.0001,0.0],[0.0001,0.0004,0.0083,0.0,0.0,0.0,0.0057,0.094,0.0039,0.0156,0.0,0.0,0.0,0.0,0.0,0.0681,0.2156,0.3894,0.046,0.0001,0.3469,0.0,0.0,0.0,0.0026,0.0,0.0,0.0,0.0016,0.0068],[0.0095,0.0113,0.1668,0.0174,0.0003,0.0027,0.0038,0.001,0.0,0.0051,0.0011,0.0204,0.0037,0.0012,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],[0.0083,0.0177,0.1728,0.1736,0.0112,0.0001,0.0007,0.0024,0.1405,0.0049,0.0,0.0,0.0,0.0,0.0,0.0031,0.0,0.0001,0.0,0.0,0.0001,0.0,0.0,0.0,0.0008,0.0001,0.0,0.0,0.0002,0.0001],[0.0,0.0012,0.0066,0.1592,0.0093,0.0,0.0,0.002,0.0,0.0031,0.0111,0.0,0.0001,0.0015,0.0,0.0014,0.0,0.0,0.0,0.0,0.0003,0.0,0.0,0.0,0.0577,0.0,0.0,0.0,0.002,0.0016],[0.0,0.0001,0.0062,0.0002,0.0,0.0028,0.0037,0.001,0.0,0.002,0.0,0.099,0.0089,0.0012,0.0019,0.0009,0.0,0.0,0.2152,0.0072,0.0028,0.0,0.051,0.0,0.0007,0.0,0.0,0.0,0.0,0.0014],[0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0232,0.0,0.0,0.0091,0.0,0.0,0.0,0.0,0.0001,0.0,0.0,0.0,0.0031,0.0,0.0,0.0,0.0003,0.0001],[0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0003,0.0,0.0,0.0,0.0006,0.0682,0.0,0.0014,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0021,0.0,0.0,0.0,0.0002,0.0002],[0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0001,0.0,0.0,0.0,0.0,0.0981,0.0444,0.0,0.1321,0.0044,0.4966,0.1952,2.7158,0.1118,0.0001,0.0066,0.0,0.0,0.0,0.0348,0.0337],[0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0054,0.0717,0.3188,0.4871,0.0,0.0631,0.246,0.0,0.1607,0.0005,0.0307,0.0032,0.0002,0.0516,0.0,0.0,0.0012,0.267,0.005,0.0009,0.0059,0.0302,0.0203],[0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0001,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.1073,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0396,0.0014,0.0,0.0001,0.0,0.0],[0.0001,0.0003,0.0021,0.0152,0.0004,0.0018,0.0009,0.0006,0.0008,0.0001,0.0,0.0016,0.0001,0.0,0.0004,0.0001,0.0,0.2234,0.0013,0.0003,0.0015,0.0,0.0002,0.003,0.0015,0.0005,0.0005,0.0005,0.0011,0.0017],[0.0,0.0001,0.0016,0.0093,0.001,0.0,0.0003,0.0008,0.0019,0.0,0.0001,0.0,0.0038,0.0005,0.0036,0.0002,0.0,0.0009,0.1543,0.0029,0.0013,0.0,0.0398,0.0034,0.0001,0.0001,0.0002,0.0001,0.0005,0.0006],[0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0001,0.0,0.0,0.0,0.0,0.0,0.0001,0.0,0.0,0.0016,0.0852,0.001,0.0,0.0185,0.0011,0.0001,0.0001,0.0001,0.0002,0.0013,0.0006],[0.0011,0.0014,0.0243,0.0387,0.0007,0.0158,0.0041,0.0015,0.0155,0.0005,0.0006,0.0103,0.0187,0.0025,0.0028,0.0008,0.002,0.0148,0.0025,0.0142,0.006,0.0174,0.0097,0.0037,0.0005,0.015,0.0061,0.0017,0.0053,0.0091],[0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0004,0.0003,0.0002,0.0002,0.0001,0.0006,0.0,0.0001,0.0001,0.0052,0.0005,0.0023,0.0003,0.0074,0.0,0.0016,0.0003,0.0002,0.0045,0.0004,0.0007,0.0006],[0.002,0.0002,0.0485,0.0214,0.0001,0.1724,0.0346,0.0034,0.003,0.0012,0.0001,0.0303,0.0063,0.0058,0.0187,0.0002,0.0,0.0036,0.0003,0.0106,0.0006,0.005,0.0009,0.0147,0.0006,0.0029,0.0573,0.0701,0.0245,0.0027],[0.0087,0.0227,0.2091,0.314,0.0124,0.0815,0.1694,0.0115,0.067,0.0553,0.0577,0.1282,0.1377,0.0811,0.0421,0.0234,0.021,0.1852,0.1711,0.0958,0.0402,0.0744,0.0973,0.0408,0.0521,0.1093,0.0423,0.0291,0.0534,0.0448],[0.0,0.0001,0.0272,0.0096,0.0003,0.0013,0.0056,0.0002,0.0078,0.0002,0.0001,0.0049,0.0092,0.0026,0.006,0.0006,0.0061,0.0181,0.0028,0.005,0.0044,0.0009,0.0076,0.0253,0.0094,0.0055,0.0107,0.0159,0.0468,0.0061],[0.0025,0.0134,0.1015,0.0846,0.0027,0.0797,0.0157,0.0033,0.0244,0.0142,0.0088,0.0517,0.0277,0.013,0.0084,0.0053,0.0177,0.0566,0.0468,0.0547,0.0139,0.0108,0.0147,0.0545,0.0088,0.0345,0.049,0.016,0.0414,0.0102],[0.0,0.0,0.0,0.0019,0.0,0.0001,0.0001,0.0,0.0,0.0,0.0,0.0004,0.0001,0.0,0.0001,0.0003,0.0001,0.0022,0.0004,0.0067,0.0013,0.0003,0.0009,0.0096,0.0019,0.0041,0.1213,0.006,0.0021,0.0026],[0.0041,0.0008,0.0354,0.0134,0.0006,0.0801,0.012,0.0036,0.0224,0.0075,0.0006,0.019,0.0089,0.006,0.0063,0.0039,0.0134,0.0323,0.008,0.0154,0.0057,0.0126,0.0153,0.0757,0.0066,0.0194,0.1564,0.0924,0.0156,0.0184],[0.0,0.0,0.0,0.0,0.0001,0.0056,0.0,0.0001,0.0,0.0006,0.0,0.0,0.0022,0.0004,0.0002,0.0001,0.0002,0.0018,0.0003,0.0014,0.0012,0.0004,0.0016,0.0,0.0031,0.0012,0.0142,0.0203,0.0075,0.0023],[0.0033,0.0025,0.0282,0.0008,0.0001,0.015,0.0217,0.0012,0.0716,0.0085,0.0007,0.0349,0.0004,0.0004,0.0141,0.006,0.0124,0.015,0.0074,0.0241,0.0069,0.0013,0.0087,0.0276,0.0037,0.1344,0.1005,0.026,0.0404,0.0244]],
  BL_orig: [0.6283,0.7447,1.791,1.4359,0.6171,0.9352,0.8107,0.6348,1.0099,1.0227,1.0827,0.8715,0.808,0.9475,0.6952,0.9625,0.8263,1.5284,1.1297,1.1903,1.0224,2.5484,0.8559,0.7617,1.0227,0.7985,1.0199,0.7754,0.8191,0.7034],
  FL_orig: [0.9514,0.7243,0.8057,0.5696,0.7537,0.5624,0.7206,1.5926,0.7355,0.9287,0.7124,0.8746,0.5771,0.5874,3.2155,2.0997,0.6443,0.7398,0.7343,0.621,0.7419,0.563,1.023,2.628,0.7905,1.3316,0.6797,1.281,0.6003,1.2101],
  mult_orig: [1.1598,1.3747,3.3061,2.6507,1.1391,1.7264,1.4965,1.1719,1.8643,1.8878,1.9985,1.6087,1.4915,1.7491,1.2833,1.7766,1.5253,2.8214,2.0854,2.1972,1.8873,4.7042,1.58,1.4061,1.8879,1.474,1.8828,1.4314,1.512,1.2984],
  names: ["Padi","Umbi-Umbian","Bahan Makanan Lainnya","Sayuran","Buah-buahan","Tebu","Kelapa","Hasil Perkebunan dan Pertanian Lainnya","Jasa Pertanian","Ternak dan Hasil-hasilnya","Unggas dan Hasil-hasilnya","Kayu dan Hasil Hutan Lainnya","Ikan Laut dan Hasil Laut Lainnya","Ikan Darat dan Hasil Perairan Darat","Pertambangan dan Penggalian","Industri Makanan dan Minuman","Pengolahan Tembakau","Industri Tekstil dan Pakaian Jadi","Industri Barang Kayu dan Mebel","Industri Mineral Non Logam","Industri Barang Lainnya","Listrik, Gas dan Air Minum","Bangunan","Perdagangan","Hotel dan Rumah Makan","Angkutan","Informasi dan Komunikasi","Lembaga Keuangan, Persewaan dan Jasa Perusahaan","Pemerintahan Umum dan Pertahanan","Jasa-Jasa Lainnya"],
};

const WIZARD_STEPS = [
  { title:"Identitas Daerah", fields:[
    {k:"nama",    l:"Nama Kabupaten/Kota",     t:"text",   ph:"Contoh: Kabupaten Blora"},
    {k:"provinsi",l:"Provinsi",                t:"text",   ph:"Contoh: Jawa Tengah"},
    {k:"tahun",   l:"Tahun Data",              t:"number", ph:"2016"},
    {k:"kode",    l:"Kode BPS (4 digit)",      t:"text",   ph:"3315"},
  ]},
  { title:"PDRB Sektoral (Juta Rp, ADHB)", fields:[
    {k:"PDRB",     l:"PDRB Total",             t:"number"},
    {k:"pertanian",l:"Pertanian & Perikanan",  t:"number"},
    {k:"tambang",  l:"Pertambangan",           t:"number"},
    {k:"industri", l:"Industri Pengolahan",    t:"number"},
    {k:"utilitas", l:"Listrik, Gas & Air",     t:"number"},
    {k:"konstruksi",l:"Konstruksi",            t:"number"},
    {k:"perdagangan",l:"Perdagangan",          t:"number"},
    {k:"transportasi",l:"Transportasi",        t:"number"},
    {k:"akomodasi",l:"Akomodasi & Makan",      t:"number"},
    {k:"informasi",l:"Informasi & Komunikasi", t:"number"},
    {k:"keuangan", l:"Keuangan & Real Estate", t:"number"},
    {k:"pemerintah",l:"Adm. Pemerintahan",     t:"number"},
    {k:"jasa_lain",l:"Jasa Pendidikan+Kesehatan+Lainnya", t:"number"},
  ]},
  { title:"PDRB Pengeluaran (Juta Rp)", fields:[
    {k:"C_rt",  l:"Konsumsi Rumah Tangga",  t:"number"},
    {k:"G_gov", l:"Konsumsi Pemerintah",    t:"number"},
    {k:"I_pmtb",l:"PMTB (Investasi Tetap)", t:"number"},
    {k:"ekspor",l:"Ekspor",                 t:"number"},
    {k:"impor", l:"Impor",                  t:"number"},
  ]},
  { title:"Data Ketenagakerjaan (Sakernas)", fields:[
    {k:"puk",    l:"Penduduk Usia Kerja",   t:"number"},
    {k:"ak",     l:"Angkatan Kerja",        t:"number"},
    {k:"bekerja",l:"Penduduk Bekerja",      t:"number"},
    {k:"tpak",   l:"TPAK (%)",              t:"number"},
    {k:"tpt",    l:"TPT (%)",               t:"number"},
    {k:"formal", l:"% Sektor Formal",       t:"number"},
  ]},
  { title:"Sumber Data I-O & Metode", fields:[
    {k:"io_ref", l:"Kabupaten I-O Referensi", t:"select",
      opts:["Jepara (Jateng)","Banyumas (Jateng)","Cilacap (Jateng)","I-O Provinsi Jateng","Kudus (Jateng)","Upload File Sendiri"]},
    {k:"metode", l:"Metode Regionalisasi",    t:"select",
      opts:["RAS Biproportional Scaling","Location Quotient (LQ)","GRIT (LQ+RAS)"]},
    {k:"io_prov",l:"Tabel I-O Provinsi Pembanding", t:"select",
      opts:["Jawa Tengah","Jawa Barat","Jawa Timur","Jawa & Bali (Nasional)"]},
  ]},
];

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const GRP = {Pertanian:"#22c55e",Perikanan:"#0ea5e9",Pertambangan:"#f59e0b",Industri:"#f97316",Utilitas:"#8b5cf6",Konstruksi:"#ec4899",Jasa:"#06b6d4"};
const PAL = ["#22c55e","#0ea5e9","#f59e0b","#f97316","#8b5cf6","#ec4899","#06b6d4","#14b8a6","#a78bfa","#fb923c","#34d399","#60a5fa"];
const fmt  = (n,d=0)=>typeof n==="number"?n.toLocaleString("id-ID",{maximumFractionDigits:d}):"-";
const fmtT = v=>v>=1e9?`${(v/1e9).toFixed(1)}T`:v>=1e6?`${(v/1e6).toFixed(1)}M`:v>=1e3?`${(v/1e3).toFixed(0)}K`:fmt(v);
const mono = {fontFamily:"'Courier New',monospace"};
const card = {background:"#0f172a",border:"1px solid #1e293b",borderRadius:12,padding:20};

// CGE computation
function runCGE(sektor, makro, si, amt, type){
  const s = sektor[si]; if(!s) return null;
  const totOut   = sektor.reduce((a,b)=>a+b.output,0);
  const totFL    = sektor.reduce((a,b)=>a+b.fl,0);
  const totUpah  = sektor.reduce((a,b)=>a+b.upah,0);
  const totNTB   = sektor.reduce((a,b)=>a+b.ntb,0);

  // ── PARAMETER MEKANISME PER JENIS KEBIJAKAN ──────────────
  // Setiap kebijakan punya jalur transmisi & efisiensi yang berbeda
  // Referensi: Sugema & Holis (2015), Oktaviani (2008)
  const typeParams = {
    investasi: {
      // Investasi: masuk sebagai PMTB, langsung ke sektor produksi
      // Multiplier penuh karena permintaan barang modal → backward linkage aktif
      multFactor:   1.00,   // 100% dari multiplier Leontief
      incomeFactor: 1.00,   // upah naik penuh (labor demand meningkat)
      mpc:          0.68,   // MPC standar
      govTaxRate:   0.030,  // pajak dari keuntungan investasi lebih tinggi
      importLeakage:0.12,   // sebagian barang modal diimpor
      expEffect:    0.00,
      priceEffect:  0.008,  // harga cenderung naik sedikit (demand-pull)
      desc: "Investasi masuk langsung ke permintaan barang modal — multiplier Leontief penuh aktif."
    },
    subsidi: {
      // Subsidi: mengurangi biaya produksi → output meningkat, harga turun
      // Sebagian subsidi hilang ke konsumen (tidak semua ke produksi)
      multFactor:   0.82,   // 82% efisiensi (18% deadweight loss subsidi)
      incomeFactor: 0.85,   // upah naik lebih lambat (cost-push bukan demand-pull)
      mpc:          0.72,   // MPC lebih tinggi: RT miskin lebih diuntungkan subsidi
      govTaxRate:   0.015,  // penerimaan pajak turun (harga lebih rendah)
      importLeakage:0.08,   // subsidi mendorong produksi domestik → impor berkurang
      expEffect:    0.15,   // harga domestik turun → daya saing ekspor meningkat
      priceEffect: -0.025,  // harga turun (cost-push ke konsumen berkurang)
      desc: "Subsidi mengurangi biaya produksi. Harga konsumen turun, daya saing ekspor meningkat, tapi ada deadweight loss."
    },
    ekspor: {
      // Shock ekspor: permintaan luar negeri naik → produsen meningkatkan output
      // Efek kuat pada sektor yang FL-nya tinggi (pemasok ke ekspor)
      multFactor:   1.08,   // lebih besar dari investasi (multiplier ekspor > 1 via pendapatan valas)
      incomeFactor: 1.15,   // upah naik lebih besar (sektor ekspor umumnya padat TK)
      mpc:          0.65,   // MPC sedikit lebih rendah (sebagian tabung dari windfall)
      govTaxRate:   0.035,  // pajak ekspor + PPh meningkat signifikan
      importLeakage:0.18,   // impor input meningkat (bahan baku ekspor banyak diimpor)
      expEffect:    amt * 0.40,  // ekspor langsung meningkat
      priceEffect:  0.015,  // harga produsen naik (permintaan luar negeri)
      desc: "Peningkatan ekspor mendorong produksi lebih kuat — surplus valas masuk, upah TK meningkat signifikan."
    },
    belanja_pemerintah: {
      // Belanja pemerintah: G langsung masuk ke permintaan akhir
      // Mirip investasi tapi lebih banyak ke jasa dan infrastruktur
      multFactor:   0.90,   // sedikit lebih rendah (sebagian ke impor, birokrasi)
      incomeFactor: 1.10,   // upah PNS & sektor jasa naik lebih besar
      mpc:          0.70,
      govTaxRate:  -0.010,  // penerimaan pajak turun (defisit anggaran bertambah)
      importLeakage:0.15,   // proyek pemerintah sering impor material
      expEffect:    0.00,
      priceEffect:  0.012,  // tekanan inflasi dari demand pemerintah
      desc: "Belanja pemerintah meningkatkan permintaan langsung. Sebagian bocor ke impor material proyek."
    },
    pajak: {
      // Kenaikan pajak: menarik uang dari perekonomian → efek negatif
      // Shock berupa PENGURANGAN output (dampak kontraktif)
      multFactor:  -0.75,   // negatif — pajak menurunkan output
      incomeFactor:-0.80,   // pendapatan RT berkurang (disposable income turun)
      mpc:          0.60,   // MPC turun (RT lebih hemat saat pendapatan berkurang)
      govTaxRate:   0.20,   // penerimaan pajak pemerintah NAIK signifikan
      importLeakage:0.05,   // impor turun (daya beli berkurang)
      expEffect:   -0.10 * amt, // ekspor turun (daya saing berkurang)
      priceEffect:  0.030,  // harga naik (cost-push dari pajak)
      desc: "Kenaikan pajak bersifat kontraktif — menarik uang dari RT dan bisnis, menurunkan output dan konsumsi."
    },
  };

  const p = typeParams[type] || typeParams.investasi;
  const shock = amt;

  // Hitung total dengan multiplier yang disesuaikan per jenis kebijakan
  const effectiveMult = s.mult * p.multFactor;
  const direct   = shock;
  const indirect = shock * Math.max(0, effectiveMult - 1);
  const total    = shock * effectiveMult;

  // Jalur transmisi disesuaikan
  const roundOne   = shock * 0.45 * Math.abs(p.multFactor);
  const roundTwo   = indirect * 0.35;
  const roundThree = indirect * 0.20;

  // Efek faktor — disesuaikan per jenis
  const incomeEff  = total * (totUpah/totOut) * p.incomeFactor;
  const consumpEff = incomeEff * p.mpc;
  const govRevEff  = total * p.govTaxRate;
  const importLeakage = shock * p.importLeakage;
  const expEff     = typeof p.expEffect === "number" && p.expEffect !== 0
                     ? p.expEffect : 0;

  const employEff  = Math.round(Math.abs(total) / (totOut / sektor.filter(x=>x.upah>0).length) * 8);

  const priceEff   = p.priceEffect;
  const gdpEff     = (total / makro.PDRB) * 100;

  const sectorImpact = sektor.map(d=>({
    nama:d.nama.slice(0,20), grp:d.grp,
    dampak: total * d.fl / totFL,
    ntb_add: total * d.fl / totFL * (d.ntb / d.output),
  })).sort((a,b)=>b.dampak-a.dampak);

  // Sankey nodes & links (mekanisme transmisi)
  const sankeyNodes = [
    {name:`Shock: ${type} Rp${fmtT(shock)} Jt`},   // 0
    {name:"Permintaan Langsung"},                     // 1
    {name:"Input Antara Putaran 1"},                  // 2
    {name:"Input Antara Putaran 2+"},                 // 3
    {name:"Pendapatan Faktor TK"},                    // 4
    {name:"Pendapatan Faktor Kapital"},               // 5
    {name:"Konsumsi RT (Induced)"},                   // 6
    {name:"Penerimaan Pemerintah"},                   // 7
    {name:"Ekspor Neto"},                             // 8
    {name:"Impor (Kebocoran)"},                       // 9
    {name:"Output Total Tercipta"},                   // 10
  ];
  const sankeyLinks = [
    {source:0,target:1,value:shock},
    {source:1,target:2,value:roundOne},
    {source:1,target:4,value:shock*(s.upah/s.output)},
    {source:1,target:5,value:shock*((s.ntb-s.upah)/s.output)},
    {source:2,target:3,value:roundTwo},
    {source:2,target:9,value:shock*0.12},
    {source:3,target:10,value:roundThree},
    {source:4,target:6,value:consumpEff},
    {source:4,target:7,value:govRevEff*0.3},
    {source:5,target:7,value:govRevEff*0.7},
    {source:6,target:10,value:consumpEff*0.6},
    {source:6,target:9,value:consumpEff*0.15},
    ...(expEff>0?[{source:1,target:8,value:expEff}]:[]),
  ];

  // Transmisi langkah per langkah — disesuaikan per jenis kebijakan
  const typeLabel = {
    investasi:"Investasi Masuk ke Sektor Produksi",
    subsidi:"Subsidi Mengurangi Biaya Produksi",
    ekspor:"Permintaan Ekspor Meningkat",
    belanja_pemerintah:"Belanja Pemerintah Masuk ke Pasar",
    pajak:"Pajak Menarik Dana dari Perekonomian",
  };
  const steps = [
    {step:1, label:"Shock Kebijakan",
     desc:`[${(typeLabel[type]||type).toUpperCase()}] Rp ${fmt(Math.round(shock))} Jt ke ${s.nama}. ${p.desc}`,
     val:shock, pct:100},
    {step:2, label:"Efek Output Langsung",
     desc:`Multiplier efektif = ${effectiveMult.toFixed(3)}× (base ${s.mult.toFixed(3)}× × faktor ${p.multFactor.toFixed(2)}). Output ${s.nama} ${total>=0?"meningkat":"menurun"} Rp ${fmt(Math.round(Math.abs(direct)))} Jt.`,
     val:Math.abs(direct), pct:100},
    {step:3, label:"Efek Tak Langsung (Backward)",
     desc:`Sektor hulu ikut tergerak via input-output (BL=${s.bl_n.toFixed(3)}). Tambahan output Rp ${fmt(Math.round(Math.abs(roundOne)))} Jt (putaran 1) + Rp ${fmt(Math.round(Math.abs(roundTwo)))} Jt (putaran 2+).`,
     val:Math.abs(roundOne+roundTwo), pct:Math.round((Math.abs(roundOne+roundTwo)/Math.abs(total||1))*100)},
    {step:4, label:"Efek Pendapatan RT",
     desc:`Upah ${total>=0?"naik":"turun"} Rp ${fmt(Math.round(Math.abs(incomeEff)))} Jt (faktor ${p.incomeFactor.toFixed(2)}). RT ${total>=0?"meningkatkan":"mengurangi"} konsumsi Rp ${fmt(Math.round(Math.abs(consumpEff)))} Jt (MPC=${p.mpc.toFixed(2)}).`,
     val:Math.abs(incomeEff), pct:Math.round((Math.abs(incomeEff)/Math.abs(total||1))*100)},
    {step:5, label:"Efek Fiskal & Perdagangan",
     desc:`Pajak pemerintah: ${govRevEff>=0?"+":""}Rp ${fmt(Math.round(govRevEff))} Jt. Kebocoran impor: -Rp ${fmt(Math.round(importLeakage))} Jt. ${expEff!==0?"Ekspor: "+(expEff>0?"+":"")+fmt(Math.round(expEff))+" Jt.":""}`,
     val:Math.abs(govRevEff)+importLeakage, pct:Math.round(((Math.abs(govRevEff)+importLeakage)/Math.abs(total||1))*100)},
    {step:6, label:"Total Dampak Bersih",
     desc:`Multiplier efektif ${effectiveMult.toFixed(3)}× → Total Rp ${fmt(Math.round(total))} Jt. Harga ${priceEff>0?"naik":"turun"} ${(Math.abs(priceEff)*100).toFixed(1)}% (estimasi).`,
     val:Math.abs(total), pct:100},
  ];

  return { s, shock, direct, indirect, total, roundOne, roundTwo, roundThree,
    incomeEff, consumpEff, govRevEff, employEff, priceEff, gdpEff, expEff,
    importLeakage, effectiveMult, typeParams: p, type,
    sectorImpact, sankeyNodes, sankeyLinks, steps };
}

// ─────────────────────────────────────────────
// UI ATOMS
// ─────────────────────────────────────────────
const Badge = ({c="#22c55e",children})=>(
  <span style={{background:`${c}20`,color:c,padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:700}}>{children}</span>
);
const KPI = ({label,value,unit,color="#22c55e",sub,icon})=>(
  <div style={{...card,borderLeft:`3px solid ${color}`,position:"relative",overflow:"hidden"}}>
    <div style={{position:"absolute",top:10,right:14,fontSize:22,opacity:0.12}}>{icon}</div>
    <div style={{fontSize:10,color:"#64748b",...mono,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>{label}</div>
    <div style={{fontSize:22,fontWeight:800,color:"#f8fafc"}}>{value}<span style={{fontSize:12,color,marginLeft:4}}>{unit}</span></div>
    {sub&&<div style={{fontSize:10,color:"#475569",marginTop:2}}>{sub}</div>}
  </div>
);
const Sec = ({title,accent="#22c55e",sub,children})=>(
  <div style={{margin:"28px 0 14px"}}>
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:sub?4:14}}>
      <div style={{width:3,height:20,background:accent,borderRadius:2}}/>
      <h2 style={{margin:0,fontSize:15,fontWeight:700,color:"#f1f5f9"}}>{title}</h2>
    </div>
    {sub&&<p style={{margin:"0 0 14px 13px",fontSize:12,color:"#64748b",lineHeight:1.6,borderLeft:"2px solid #1e293b",paddingLeft:10}}>{sub}</p>}
    {children}
  </div>
);
const Tab = ({active,onClick,children})=>(
  <button onClick={onClick} style={{padding:"7px 15px",borderRadius:7,border:"none",cursor:"pointer",fontSize:11,fontWeight:700,...mono,background:active?"#22c55e":"#1e293b",color:active?"#0f172a":"#64748b",transition:"all 0.2s",whiteSpace:"nowrap"}}>{children}</button>
);
const Chip = ({active,onClick,color="#22c55e",children})=>(
  <button onClick={onClick} style={{padding:"4px 12px",borderRadius:20,border:`1px solid ${active?color:"#334155"}`,background:active?`${color}20`:"transparent",color:active?color:"#64748b",fontSize:11,cursor:"pointer",fontWeight:600}}>{children}</button>
);
const TT = ({content,children})=>{
  const [show,setShow]=useState(false);
  return <span style={{position:"relative",display:"inline-block"}} onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)}>
    {children}
    {show&&<div style={{position:"absolute",bottom:"100%",left:"50%",transform:"translateX(-50%)",background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"8px 12px",fontSize:11,color:"#e2e8f0",whiteSpace:"nowrap",zIndex:100,boxShadow:"0 4px 20px #000a",minWidth:200,maxWidth:300,lineHeight:1.5}}>{content}</div>}
  </span>;
};

// ─────────────────────────────────────────────
// TRANSMISI DAMPAK VISUAL
// ─────────────────────────────────────────────
function TransmisiDampak({ result }) {
  const [activeStep, setActiveStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setActiveStep(s => (s + 1) % result.steps.length), 1800);
    return () => clearInterval(id);
  }, [result]);

  const cols = ["#22c55e","#0ea5e9","#f59e0b","#f97316","#8b5cf6","#06b6d4"];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* Flow Diagram */}
      <div style={card}>
        <div style={{ fontSize: 11, color: "#64748b", ...mono, marginBottom: 14 }}>MEKANISME TRANSMISI DAMPAK — ALUR STEP BY STEP</div>
        <div style={{ position: "relative" }}>
          {result.steps.map((st, i) => (
            <div key={i} onClick={() => setActiveStep(i)} style={{
              display: "flex", gap: 12, marginBottom: 10, cursor: "pointer",
              opacity: activeStep === i ? 1 : 0.5, transition: "opacity 0.3s"
            }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%", background: cols[i],
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 800, color: "#0f172a", ...mono,
                  boxShadow: activeStep === i ? `0 0 12px ${cols[i]}` : "none",
                  transition: "box-shadow 0.3s"
                }}>{st.step}</div>
                {i < result.steps.length - 1 && (
                  <div style={{ width: 2, flex: 1, minHeight: 16, background: activeStep > i ? cols[i] : "#1e293b", transition: "background 0.5s", margin: "2px 0" }} />
                )}
              </div>
              <div style={{ flex: 1, paddingBottom: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: cols[i], marginBottom: 2 }}>{st.label}</div>
                <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>{st.desc}</div>
                <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, height: 5, background: "#1e293b", borderRadius: 3 }}>
                    <div style={{ width: `${st.pct}%`, height: "100%", background: cols[i], borderRadius: 3, transition: "width 0.6s" }} />
                  </div>
                  <span style={{ fontSize: 10, color: cols[i], ...mono, width: 60, textAlign: "right" }}>
                    {st.val > 0 ? `Rp ${fmtT(st.val)}` : ""}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sankey-style flow */}
      <div style={card}>
        <div style={{ fontSize: 11, color: "#64748b", ...mono, marginBottom: 14 }}>DIAGRAM ALIRAN NILAI (MENYEDERHANAKAN SANKEY)</div>
        <svg width="100%" viewBox="0 0 420 320" style={{ overflow: "visible" }}>
          {/* Simplified Sankey-like visualization */}
          {[
            { y: 30,  x: 10,  w: 100, h: 26, label: `Shock Awal`, val: result.shock, c: "#22c55e" },
            { y: 80,  x: 10,  w: 70,  h: 20, label: "Input Langsung", val: result.roundOne, c: "#0ea5e9" },
            { y: 80,  x: 100, w: 60,  h: 20, label: "Upah TK", val: result.incomeEff, c: "#f59e0b" },
            { y: 80,  x: 175, w: 55,  h: 20, label: "Surplus", val: result.shock * 0.28, c: "#f97316" },
            { y: 130, x: 10,  w: 60,  h: 18, label: "Putaran 2+", val: result.roundTwo, c: "#8b5cf6" },
            { y: 130, x: 85,  w: 60,  h: 18, label: "Konsumsi RT", val: result.consumpEff, c: "#ec4899" },
            { y: 130, x: 160, w: 55,  h: 18, label: "Pajak Gov", val: result.govRevEff, c: "#06b6d4" },
            { y: 130, x: 228, w: 50,  h: 18, label: "Impor Bocor", val: result.shock * 0.12, c: "#64748b" },
            { y: 190, x: 30,  w: 120, h: 28, label: `Total Output = Rp ${fmtT(result.total)} Jt`, val: result.total, c: "#22c55e" },
          ].map((n, i) => (
            <g key={i}>
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={4} fill={`${n.c}30`} stroke={n.c} strokeWidth={1.5} />
              <text x={n.x + n.w / 2} y={n.y + n.h / 2 - 3} textAnchor="middle" fontSize={8} fill={n.c} fontWeight={700}>{n.label}</text>
              <text x={n.x + n.w / 2} y={n.y + n.h / 2 + 8} textAnchor="middle" fontSize={8} fill="#94a3b8" fontFamily="monospace">{fmtT(n.val)}</text>
            </g>
          ))}
          {/* Arrows */}
          {[
            [60, 56, 40, 80], [60, 56, 130, 80], [60, 56, 200, 80],
            [40, 100, 40, 130], [130, 100, 115, 130], [200, 100, 185, 130], [200, 100, 253, 130],
            [95, 148, 90, 190],
          ].map(([x1, y1, x2, y2], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#334155" strokeWidth={1.5} strokeDasharray="4 2"
              markerEnd="url(#arr)" />
          ))}
          <defs>
            <marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#334155" />
            </marker>
          </defs>
          {/* Multiplier info */}
          <text x={280} y={50} fontSize={11} fill="#22c55e" fontWeight={800} fontFamily="monospace">Multiplier</text>
          <text x={280} y={66} fontSize={22} fill="#22c55e" fontWeight={900} fontFamily="monospace">{result.s.mult.toFixed(3)}×</text>
          <text x={280} y={84} fontSize={9} fill="#64748b" fontFamily="monospace">Rp {fmtT(result.shock)} →</text>
          <text x={280} y={96} fontSize={9} fill="#64748b" fontFamily="monospace">Rp {fmtT(result.total)} output</text>
          <rect x={272} y={110} width={135} height={60} rx={6} fill="#22c55e15" stroke="#22c55e40" strokeWidth={1} />
          <text x={280} y={126} fontSize={9} fill="#94a3b8">BL Norm: {result.s.bl_n.toFixed(3)}</text>
          <text x={280} y={139} fontSize={9} fill="#94a3b8">FL Norm: {result.s.fl_n.toFixed(3)}</text>
          <text x={280} y={152} fontSize={9} fill="#94a3b8">VA/Out: {(result.s.ntb/result.s.output*100).toFixed(1)}%</text>
          <text x={280} y={165} fontSize={9} fill="#94a3b8">Kelompok: {result.s.grp}</text>
        </svg>

        {/* Waterfall mini */}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, color: "#64748b", ...mono, marginBottom: 8 }}>DEKOMPOSISI DAMPAK (Juta Rp)</div>
          {[
            ["Efek Langsung (Direct)", result.direct, "#22c55e"],
            ["Efek Tak Langsung (Indirect)", result.indirect * 0.6, "#0ea5e9"],
            ["Efek Pendapatan (Induced)", result.consumpEff, "#f59e0b"],
            ["(-) Kebocoran Impor", -(result.shock * 0.12), "#ef4444"],
          ].map(([l, v, c]) => (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <div style={{ flex: 1, fontSize: 10, color: "#94a3b8" }}>{l}</div>
              <div style={{ width: 100, height: 6, background: "#1e293b", borderRadius: 3 }}>
                <div style={{ width: `${Math.min(100, (Math.abs(v) / result.total) * 100)}%`, height: "100%", background: c, borderRadius: 3 }} />
              </div>
              <span style={{ fontSize: 10, color: c, ...mono, width: 70, textAlign: "right" }}>
                {v < 0 ? "-" : "+"}{fmtT(Math.abs(v))}
              </span>
            </div>
          ))}
          <div style={{ borderTop: "1px solid #334155", paddingTop: 6, display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10, color: "#f8fafc", fontWeight: 700 }}>TOTAL DAMPAK BERSIH</span>
            <span style={{ fontSize: 11, color: "#22c55e", ...mono, fontWeight: 800 }}>Rp {fmt(Math.round(result.total))} Jt</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// INTERPRETASI OTOMATIS
// ─────────────────────────────────────────────
function Interpretasi({ result, sektor, makro }) {
  if (!result) return null;
  const s = result.s;
  const quadrant = s.bl_n > 1 && s.fl_n > 1 ? "Kunci" : s.bl_n <= 1 && s.fl_n > 1 ? "Pemimpin" : s.bl_n > 1 && s.fl_n <= 1 ? "Pengikut" : "Independen";
  const qColor = quadrant === "Kunci" ? "#22c55e" : quadrant === "Pemimpin" ? "#0ea5e9" : quadrant === "Pengikut" ? "#f59e0b" : "#64748b";
  const efficiencyRank = [...sektor].sort((a, b) => b.mult - a.mult).findIndex(x => x.id === s.id) + 1;
  const gdpImpact = result.gdpEff.toFixed(2);
  const multAssess = result.s.mult >= 3 ? "sangat tinggi" : result.s.mult >= 2 ? "tinggi" : result.s.mult >= 1.5 ? "sedang" : "rendah";
  const rekomendasi = result.s.mult >= 2 ?
    `Sektor ${s.nama} merupakan sektor prioritas tinggi untuk injeksi kebijakan. Setiap Rp 1 Triliun investasi di sektor ini akan menciptakan Rp ${result.s.mult.toFixed(2)} Triliun output ekonomi secara total.` :
    `Sektor ${s.nama} memiliki multiplier ${multAssess}. Untuk meningkatkan dampak, pertimbangkan memperkuat keterkaitan hulu-hilir atau menggabungkan dengan kebijakan di sektor yang memiliki forward linkage tinggi seperti ${[...sektor].sort((a, b) => b.fl_n - a.fl_n)[0]?.nama}.`;

  return (
    <div style={{ ...card, marginBottom: 16 }}>
      <div style={{ fontSize: 12, color: "#22c55e", ...mono, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <span>🔍</span> INTERPRETASI OTOMATIS HASIL SIMULASI
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", marginBottom: 8 }}>Analisis Sektor: {s.nama}</div>
          <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.8 }}>
            Sektor <strong style={{ color: "#f1f5f9" }}>{s.nama}</strong> berada di{" "}
            <strong style={{ color: qColor }}>Kuadran {quadrant}</strong> dalam diagram keterkaitan (BL norm = {s.bl_n.toFixed(3)}, FL norm = {s.fl_n.toFixed(3)}).{" "}
            {quadrant === "Kunci" && "Sektor ini memiliki daya penyebaran dan derajat kepekaan di atas rata-rata — investasi di sini berdampak ganda ke seluruh perekonomian."}
            {quadrant === "Pemimpin" && "Sektor ini kuat mendorong ke depan (FL tinggi) tetapi daya penyebaran ke belakang rendah. Cocok sebagai sektor lokomotif hilirisasi."}
            {quadrant === "Pengikut" && "Sektor ini kuat menarik input dari belakang (BL tinggi). Pertumbuhan sektor ini akan menggerakkan banyak sektor hulu."}
            {quadrant === "Independen" && "Sektor ini relatif berdiri sendiri. Kebijakan di sektor lain lebih efektif untuk menggerakkan perekonomian."}
          </div>
          <div style={{ marginTop: 10, padding: "10px 14px", background: `${qColor}15`, borderRadius: 8, borderLeft: `3px solid ${qColor}`, fontSize: 12, color: "#e2e8f0", lineHeight: 1.7 }}>
            <strong style={{ color: qColor }}>Rekomendasi:</strong> {rekomendasi}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", marginBottom: 8 }}>Hasil Simulasi — Angka & Makna</div>
          {[
            ["Multiplier Output", `${result.s.mult.toFixed(3)}×`, `Setiap Rp 1 Jt injeksi menciptakan Rp ${result.s.mult.toFixed(3)} Jt output total (rangking ke-${efficiencyRank} dari ${sektor.length} sektor)`, result.s.mult >= 2 ? "#22c55e" : "#f59e0b"],
            ["Dampak Total Output", `Rp ${fmt(Math.round(result.total))} Jt`, `Dari shock Rp ${fmt(Math.round(result.shock))} Jt → multiplier menciptakan Rp ${fmt(Math.round(result.indirect))} Jt output tambahan`, "#0ea5e9"],
            ["Dampak ke PDRB", `+${gdpImpact}%`, `Peningkatan PDRB ${gdpImpact}% setara dengan Rp ${fmt(Math.round(makro.PDRB * result.gdpEff / 100))} Jt nilai tambah`, "#f59e0b"],
            ["Dampak ke Upah TK", `Rp ${fmt(Math.round(result.incomeEff))} Jt`, `Pendapatan tenaga kerja meningkat, mengalir ke konsumsi RT (induced effect)`, "#8b5cf6"],
            ["Penerimaan Pajak", `Rp ${fmt(Math.round(result.govRevEff))} Jt`, `Pemerintah menerima tambahan pajak dari aktivitas ekonomi yang meningkat`, "#06b6d4"],
            ["Estimasi Lapangan Kerja", `~${fmt(result.employEff)} orang`, `Perkiraan kasar — bergantung pada intensitas TK sektor terkait`, "#f97316"],
          ].map(([k, v, desc, c]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", padding: "6px 0", borderBottom: "1px solid #1e293b" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <TT content={desc}><span style={{ fontSize: 11, color: "#94a3b8", cursor: "help", borderBottom: "1px dashed #334155" }}>{k} ℹ️</span></TT>
                <span style={{ fontSize: 12, color: c, fontWeight: 700, ...mono }}>{v}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// CARA MENJALANKAN (MODAL/TAB)
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// SANKEY CHART KUSTOM (SVG native, no library)
// ─────────────────────────────────────────────
function SankeyIO({ sektor }) {
  // Agregasi output per kelompok
  const groups = ["Pertanian","Perikanan","Pertambangan","Industri","Utilitas","Konstruksi","Jasa"];
  const grpData = groups.map(g => ({
    nama: g,
    output: sektor.filter(s=>s.grp===g).reduce((a,b)=>a+b.output,0),
    ntb:    sektor.filter(s=>s.grp===g).reduce((a,b)=>a+b.ntb,0),
    upah:   sektor.filter(s=>s.grp===g).reduce((a,b)=>a+b.upah,0),
    color:  GRP[g]||"#64748b"
  })).filter(g=>g.output>0);

  const totalOut = grpData.reduce((a,b)=>a+b.output,0);
  const totalNTB = grpData.reduce((a,b)=>a+b.ntb,0);
  const totalUpah= grpData.reduce((a,b)=>a+b.upah,0);

  const W=660, H=340, PAD=14;
  const colW=110, gap=20;

  // Posisi Y setiap sektor (kiri)
  let yOff=PAD; const nodeH=H-2*PAD;
  const srcNodes = grpData.map(g=>{
    const h = Math.max(18, (g.output/totalOut)*nodeH);
    const node = {...g, x:0, y:yOff, h};
    yOff += h+5;
    return node;
  });

  // Node tengah: NTB & Upah & Surplus
  const ntbH  = (totalNTB/totalOut)*nodeH;
  const upahH = (totalUpah/totalOut)*nodeH;
  const surpH = ((totalNTB-totalUpah)/totalOut)*nodeH;
  const midNodes = [
    {nama:"Total Output",  color:"#334155", x:colW+gap, y:PAD, h:nodeH, val:totalOut},
  ];
  const rightNodes = [
    {nama:"Nilai Tambah", color:"#22c55e", x:colW*2+gap*2, y:PAD, h:ntbH, val:totalNTB},
    {nama:"Input Antara", color:"#0ea5e9", x:colW*2+gap*2, y:PAD+ntbH+4, h:nodeH-ntbH-4, val:totalOut-totalNTB},
  ];
  const far = [
    {nama:"Upah & Gaji",   color:"#f59e0b", x:colW*3+gap*3, y:PAD, h:upahH, val:totalUpah},
    {nama:"Surplus Usaha", color:"#f97316", x:colW*3+gap*3, y:PAD+upahH+4, h:Math.max(10,surpH-4), val:totalNTB-totalUpah},
    {nama:"Input Antara",  color:"#8b5cf6", x:colW*3+gap*3, y:PAD+ntbH+8, h:nodeH-ntbH-8, val:totalOut-totalNTB},
  ];

  const fmtV = v => v>=1e6?`${(v/1e6).toFixed(1)}T`:`${(v/1e3).toFixed(0)}M`;

  // Buat path kurva bezier antara dua node
  const flow = (x1,y1,h1,x2,y2,h2,color,opacity=0.3) => {
    const mx = (x1+x2)/2;
    return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2} L${x2},${y2+h2} C${mx},${y2+h2} ${mx},${y1+h1} ${x1},${y1+h1} Z"
      fill="${color}" opacity="${opacity}" stroke="${color}" stroke-width="0.5" stroke-opacity="0.6"/>`;
  };

  // Aliran dari sektor ke total output
  let flows = "";
  let srcY = PAD;
  srcNodes.forEach(n => {
    flows += flow(colW, n.y, n.h, colW+gap, PAD, nodeH*(n.output/totalOut), n.color);
  });
  // Total output ke NTB/InputAntara
  flows += flow(colW*2+gap, PAD, ntbH, colW*2+gap*2, PAD, ntbH, "#22c55e");
  flows += flow(colW*2+gap, PAD+ntbH, nodeH-ntbH, colW*2+gap*2, PAD+ntbH+4, nodeH-ntbH-4, "#0ea5e9");
  // NTB ke Upah/Surplus
  flows += flow(colW*3+gap*2, PAD, upahH, colW*3+gap*3, PAD, upahH, "#f59e0b");
  flows += flow(colW*3+gap*2, PAD+upahH, ntbH-upahH, colW*3+gap*3, PAD+upahH+4, Math.max(8,surpH-4), "#f97316");
  // Input antara ke blok input antara
  flows += flow(colW*3+gap*2, PAD+ntbH, nodeH-ntbH, colW*3+gap*3, PAD+ntbH+8, nodeH-ntbH-8, "#8b5cf6");

  // Render node
  const renderNode = (nodes) => nodes.map(n => `
    <g>
      <rect x="${n.x}" y="${n.y}" width="${colW}" height="${n.h}" rx="4"
        fill="${n.color}" fill-opacity="0.85" stroke="${n.color}" stroke-width="1"/>
      <text x="${n.x+colW/2}" y="${n.y+Math.min(n.h/2,14)}" text-anchor="middle"
        fill="#fff" font-size="${n.h>30?10:8}" font-weight="bold" font-family="Arial"
        dominant-baseline="middle">${n.nama.slice(0,14)}</text>
      ${n.h>26?`<text x="${n.x+colW/2}" y="${n.y+Math.min(n.h/2,14)+12}" text-anchor="middle"
        fill="rgba(255,255,255,0.8)" font-size="8" font-family="monospace"
        dominant-baseline="middle">${fmtV(n.val||n.output)} Jt</text>`:""}
    </g>`).join("");

  const svgContent = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:${H}px;overflow:visible">
    ${flows}
    ${renderNode(srcNodes.map(n=>({...n,x:0})))}
    ${renderNode(midNodes)}
    ${renderNode(rightNodes)}
    ${renderNode(far)}
    <text x="55"  y="${H-2}" text-anchor="middle" fill="#64748b" font-size="9" font-family="Arial">Sektor Produksi</text>
    <text x="${colW+gap+55}" y="${H-2}" text-anchor="middle" fill="#64748b" font-size="9" font-family="Arial">Total Output</text>
    <text x="${colW*2+gap*2+55}" y="${H-2}" text-anchor="middle" fill="#64748b" font-size="9" font-family="Arial">Komponen NTB</text>
    <text x="${colW*3+gap*3+55}" y="${H-2}" text-anchor="middle" fill="#64748b" font-size="9" font-family="Arial">Distribusi NTB</text>
  </svg>`;

  return (
    <div style={{...card, marginBottom:14}}>
      <div style={{fontSize:11,color:"#64748b",...mono,marginBottom:10}}>
        SANKEY DIAGRAM — ALIRAN OUTPUT & DISTRIBUSI NILAI TAMBAH (Juta Rp)
      </div>
      <div dangerouslySetInnerHTML={{__html: svgContent}}/>
    </div>
  );
}

// ─────────────────────────────────────────────
// SANKEY SAM — aliran pendapatan antar institusi
// ─────────────────────────────────────────────
function SankeySAM({ SAM }) {
  const labels = SAM.labels||[];
  const matrix = SAM.matrix||[];
  if (!labels.length||!matrix.length) return null;

  const W=700, H=320, PAD=12;
  const cols=["#f97316","#0ea5e9","#f59e0b","#22c55e","#8b5cf6","#ec4899","#64748b"];

  // Hitung total per akun
  const totals = labels.map((_,i)=> matrix[i]?.reduce((a,b)=>a+b,0)||0);
  const maxT   = Math.max(...totals, 1);
  const nodeH  = H - 2*PAD;

  // Node kiri (pengeluaran/kolom) dan kanan (penerimaan/baris)
  const spacing = nodeH / labels.length;
  const nodeW   = 90;
  const lNodes  = labels.map((l,i)=>({ label:l, color:cols[i], y:PAD+i*spacing, h:Math.max(16,spacing-6), total:totals[i] }));
  const rNodes  = labels.map((l,i)=>({ label:l, color:cols[i], y:PAD+i*spacing, h:Math.max(16,spacing-6), total:totals[i] }));

  const fmtV = v=>v>=1e6?`${(v/1e6).toFixed(1)}T`:v>=1e3?`${(v/1e3).toFixed(0)}M`:"0";

  // Gambar aliran signifikan (nilai > 5% total)
  let flows = "";
  const threshold = maxT * 0.03;
  matrix.forEach((row,i)=>{
    row.forEach((v,j)=>{
      if(v < threshold || i===j) return;
      const src = lNodes[j]; // kolom j membayar
      const dst = rNodes[i]; // baris i menerima
      const frac= v/totals[j];
      const fh  = Math.max(3, src.h*frac);
      const mx  = (nodeW+120+nodeW)/2 + 50;
      const sx  = nodeW, sy = src.y + src.h*(j<i?0.3:0.7);
      const dx  = nodeW+120, dy= dst.y + dst.h*0.5;
      flows += `<path d="M${sx},${sy} C${mx},${sy} ${mx},${dy} ${dx},${dy}"
        fill="none" stroke="${cols[j]}" stroke-width="${Math.max(1.5,fh*0.4)}" stroke-opacity="0.5"/>`;
    });
  });

  const renderN = (nodes, xOff) => nodes.map((n,i)=>`
    <g>
      <rect x="${xOff}" y="${n.y}" width="${nodeW}" height="${n.h}" rx="3"
        fill="${n.color}" fill-opacity="0.8" stroke="${n.color}" stroke-width="1"/>
      <text x="${xOff+nodeW/2}" y="${n.y+n.h/2}" text-anchor="middle"
        fill="#fff" font-size="9" font-weight="bold" font-family="Arial"
        dominant-baseline="middle">${n.label}</text>
    </g>`).join("");

  const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:${H}px">
    ${flows}
    ${renderN(lNodes, 0)}
    ${renderN(rNodes, nodeW+120)}
    <text x="${nodeW/2}" y="${H-2}" text-anchor="middle" fill="#64748b" font-size="9" font-family="Arial">Pembayar (Kolom)</text>
    <text x="${nodeW+120+nodeW/2}" y="${H-2}" text-anchor="middle" fill="#64748b" font-size="9" font-family="Arial">Penerima (Baris)</text>
  </svg>`;

  return (
    <div style={{...card,marginBottom:14}}>
      <div style={{fontSize:11,color:"#64748b",...mono,marginBottom:10}}>
        DIAGRAM ALIRAN PENDAPATAN SAM — ANTAR INSTITUSI (garis tebal = aliran besar)
      </div>
      <div dangerouslySetInnerHTML={{__html:svg}}/>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:10}}>
        {labels.map((l,i)=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{width:10,height:10,borderRadius:2,background:cols[i]}}/>
            <span style={{fontSize:10,color:"#94a3b8"}}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// DIAGRAM ALIRAN NILAI CGE
// ─────────────────────────────────────────────
function AliranNilaiCGE({ result, makro }) {
  if (!result) return null;
  const s = result.s;
  const W=680, H=380;

  const boxes = [
    {id:"shock", x:10,  y:150, w:110, h:50, color:"#ec4899", label:"Shock Kebijakan", val:`Rp ${(result.shock/1000).toFixed(0)}M`},
    {id:"prod",  x:175, y:80,  w:110, h:50, color:"#f97316", label:"Output Sektor", val:`+${result.s.mult.toFixed(2)}×`},
    {id:"inta",  x:175, y:160, w:110, h:50, color:"#0ea5e9", label:"Input Antara", val:`Rp ${(result.roundOne/1000).toFixed(0)}M`},
    {id:"ntb",   x:175, y:240, w:110, h:50, color:"#22c55e", label:"Nilai Tambah", val:`Rp ${(result.incomeEff/1000).toFixed(0)}M`},
    {id:"sup",   x:340, y:60,  w:110, h:46, color:"#8b5cf6", label:"Sektor Hulu", val:`Putaran 2+`},
    {id:"upah",  x:340, y:170, w:110, h:46, color:"#f59e0b", label:"Upah TK", val:`Rp ${(result.incomeEff/1000).toFixed(0)}M`},
    {id:"surp",  x:340, y:260, w:110, h:46, color:"#22c55e", label:"Surplus Modal", val:`Rp ${(result.shock*0.28/1000).toFixed(0)}M`},
    {id:"rt",    x:500, y:120, w:110, h:46, color:"#0ea5e9", label:"Rumah Tangga", val:`MPC 0.68`},
    {id:"gov",   x:500, y:210, w:110, h:46, color:"#8b5cf6", label:"Pemerintah", val:`Pajak+Transfer`},
    {id:"gdp",   x:500, y:290, w:110, h:46, color:"#22c55e", label:"PDRB+", val:`+${result.gdpEff.toFixed(2)}%`},
    {id:"imp",   x:340, y:325, w:110, h:36, color:"#ef4444", label:"(-) Impor Bocor", val:`-${(result.shock*0.12/1000).toFixed(0)}M`},
  ];

  const arrows = [
    ["shock","prod"], ["shock","inta"], ["shock","ntb"],
    ["inta","sup"], ["ntb","upah"], ["ntb","surp"],
    ["sup","rt"], ["upah","rt"], ["surp","gov"],
    ["rt","gdp"], ["gov","gdp"],
    ["inta","imp"],
  ];

  const getCenter = (id, side="right") => {
    const b = boxes.find(b=>b.id===id);
    if (!b) return [0,0];
    if (side==="right") return [b.x+b.w, b.y+b.h/2];
    if (side==="left")  return [b.x, b.y+b.h/2];
    return [b.x+b.w/2, b.y+b.h/2];
  };

  const arrowPaths = arrows.map(([from,to])=>{
    const [x1,y1] = getCenter(from,"right");
    const [x2,y2] = getCenter(to,"left");
    const mx = (x1+x2)/2;
    return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"
      fill="none" stroke="#334155" stroke-width="1.5" stroke-dasharray="4,2"
      marker-end="url(#arr)"/>`;
  }).join("");

  const nodesSVG = boxes.map(b=>`
    <g>
      <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6"
        fill="${b.color}22" stroke="${b.color}" stroke-width="1.5"/>
      <text x="${b.x+b.w/2}" y="${b.y+b.h/2-6}" text-anchor="middle"
        fill="${b.color}" font-size="9.5" font-weight="bold" font-family="Arial">${b.label}</text>
      <text x="${b.x+b.w/2}" y="${b.y+b.h/2+8}" text-anchor="middle"
        fill="#94a3b8" font-size="8.5" font-family="monospace">${b.val}</text>
    </g>`).join("");

  const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:${H}px">
    <defs>
      <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 Z" fill="#475569"/>
      </marker>
    </defs>
    ${arrowPaths}
    ${nodesSVG}
    <text x="${W/2}" y="${H-4}" text-anchor="middle" fill="#475569" font-size="9" font-family="Arial">
      Diagram Aliran Nilai CGE — ${s.nama} | Shock: Rp ${(result.shock/1000).toFixed(0)}M | Multiplier: ${s.mult.toFixed(3)}×
    </text>
  </svg>`;

  return (
    <div style={{...card,marginBottom:14}}>
      <div style={{fontSize:11,color:"#64748b",...mono,marginBottom:8}}>
        DIAGRAM ALIRAN NILAI — MEKANISME TRANSMISI KEBIJAKAN
      </div>
      <div dangerouslySetInnerHTML={{__html:svg}}/>
    </div>
  );
}

// ─────────────────────────────────────────────
// PANEL METODOLOGI
// ─────────────────────────────────────────────
function PanelMetodologi() {
  const [aktif, setAktif] = useState("io");
  const menus = [
    ["io",    "📊 Regionalisasi I-O"],
    ["ras",   "🔄 Algoritma RAS"],
    ["sam",   "🏛️ Konstruksi SAM"],
    ["cge",   "⚡ Model CGE"],
    ["link",  "🔗 Analisis Keterkaitan"],
    ["mult",  "✖️ Multiplier & SAM Mult"],
    ["jenis", "🏷️ Jenis Kebijakan CGE"],
    ["dekomp","📊 Dekomposisi Dampak"],
    ["les",   "🛒 Model LES / Stone-Geary"],
    ["ihpihk","📈 IHP & IHK Endogen"],
    ["interp","🔍 Cara Interpretasi"],
  ];

  const konten = {
    io: {
      judul: "Regionalisasi Tabel Input-Output",
      sub: "Membangun I-O kabupaten dari I-O referensi + data PDRB aktual",
      isi: [
        ["Apa itu Tabel I-O?",
         "Tabel Input-Output (I-O) menggambarkan hubungan transaksi antar sektor ekonomi dalam satu periode. Baris menunjukkan ke mana output sektor dijual (output distribution), kolom menunjukkan dari mana sektor membeli input (input structure). Identitas dasar: total baris = total kolom = total output."],
        ["Mengapa Perlu Regionalisasi?",
         "BPS hanya menerbitkan Tabel I-O nasional dan beberapa provinsi. Untuk kabupaten/kota yang belum memiliki I-O sendiri, kita menggunakan I-O kabupaten tetangga yang strukturnya mirip sebagai proxy, lalu menyesuaikannya dengan data PDRB aktual daerah target."],
        ["Langkah Regionalisasi",
         "1) Pilih I-O referensi (kabupaten strukturnya mirip). 2) Hitung Structural Similarity Index (SSI) — harus > 0.75. 3) Ambil PDRB sektoral daerah target sebagai data kontrol. 4) Jalankan algoritma RAS. 5) Koreksi manual sektor yang berbeda signifikan (misal: industri mebel Jepara vs Rembang)."],
        ["Structural Similarity Index (SSI)",
         "SSI = 1 − ½ × Σ|sᵢRembang − sᵢReferensi|, di mana sᵢ adalah share PDRB sektor i. Nilai SSI mendekati 1 berarti struktur ekonomi sangat mirip. Untuk Rembang vs Jepara, SSI ≈ 0.81 — cukup valid untuk regionalisasi."],
      ]
    },
    ras: {
      judul: "Algoritma RAS Biproportional Scaling",
      sub: "Metode iteratif penyeimbangan matriks I-O",
      isi: [
        ["Prinsip Dasar RAS",
         "RAS menyesuaikan matriks transaksi awal (Z_ref) agar jumlah baris = target u (intermediate demand daerah target) dan jumlah kolom = target v (intermediate input daerah target). Prosesnya bergantian: skala baris (R), lalu skala kolom (S), hingga konvergen."],
        ["Formula Matematika",
         "Iterasi R: Z_new = diag(r) × Z, di mana r_i = u_i / Σⱼ Z_ij (target baris dibagi jumlah baris aktual). Iterasi S: Z_new = Z × diag(s), di mana s_j = v_j / Σᵢ Z_ij (target kolom dibagi jumlah kolom aktual). Ulangi hingga max|error| < 0.01%."],
        ["Data Kontrol yang Digunakan",
         "Target baris (u): PDRB sektoral × share input antara dari I-O referensi. Target kolom (v): PDRB sektoral × share input antara kolom dari I-O referensi. Kedua target dinormalisasi agar Σu = Σv (syarat RAS)."],
        ["Konvergensi dan Validasi",
         "Platform menjalankan maksimal 2000 iterasi dengan threshold error 0.01%. Setelah konvergensi, dilakukan pengecekan: rasio VA/Output per sektor harus masuk akal (pertanian 70-90%, industri 20-40%), tidak ada koefisien teknis negatif, dan total output ≈ PDRB."],
      ]
    },
    sam: {
      judul: "Konstruksi Social Accounting Matrix (SAM)",
      sub: "Matriks neraca sosial ekonomi 7×7 dari data sekunder",
      isi: [
        ["Struktur SAM 7×7",
         "SAM terdiri dari 7 akun: (1) Produksi — aktivitas produksi 31 sektor; (2) Tenaga Kerja — faktor produksi TK; (3) Kapital — faktor produksi modal; (4) Rumah Tangga — konsumsi & pendapatan RT; (5) Pemerintah — fiskal daerah; (6) Investasi — tabungan-investasi; (7) ROW — ekspor-impor."],
        ["Sumber Data per Blok SAM",
         "Blok Produksi: dari I-O hasil regionalisasi. Blok TK & Kapital: dari PDRB (nilai tambah = upah + surplus). Blok RT: dari PDRB pengeluaran (konsumsi RT). Blok Pemerintah: dari APBD (pendapatan pajak, belanja). Blok Investasi: dari PMTB + tabungan. Blok ROW: dari ekspor-impor PDRB."],
        ["Syarat Keseimbangan SAM",
         "Setiap akun harus seimbang: total baris (penerimaan) = total kolom (pengeluaran). Jika tidak seimbang, digunakan residual accounting — nilai yang tidak terhitung dimasukkan sebagai transfer tersisa (misalnya DAU/DAK dari pusat ke pemerintah daerah)."],
        ["Multiplier SAM",
         "Multiplier SAM = (I − Sa)⁻¹, di mana Sa adalah matriks SAM yang dinormalisasi per kolom untuk akun endogen (Produksi, TK, Kapital, RT). Akun eksogen (Pemerintah, Investasi, ROW) menjadi 'injeksi'. Multiplier SAM lebih besar dari multiplier I-O karena memasukkan efek pendapatan."],
      ]
    },
    cge: {
      judul: "Model CGE Sederhana (Linearized)",
      sub: "Kerangka keseimbangan umum berbasis Leontief + parameter elastisitas",
      isi: [
        ["Kerangka Model",
         "Platform menggunakan model CGE linear (Johansen-type) berbasis matriks Leontief dengan tambahan elastisitas permintaan. Model ini bersifat statis (comparative statics) — membandingkan keseimbangan sebelum dan sesudah shock kebijakan, bukan dinamika waktu."],
        ["Blok Produksi",
         "Teknologi produksi menggunakan fungsi Leontief (koefisien tetap). Output = input antara + nilai tambah faktor. Harga diasumsikan tetap dalam jangka pendek (price-taking). Tidak ada batasan kapasitas."],
        ["Blok Perdagangan (Armington)",
         "Impor dan domestik bukan substitusi sempurna (Armington assumption). Elastisitas substitusi σ_ARM = 2.0. Ekspor menggunakan fungsi CET (Constant Elasticity of Transformation) dengan σ_CET = 2.5. Nilai diambil dari Oktaviani (2008) untuk Indonesia."],
        ["Blok Tenaga Kerja",
         "Penawaran TK diasumsikan semi-elastis dengan elastisitas η_L = 0.8 terhadap upah riil. Upah bersifat fleksibel dalam jangka panjang. MPC (Marginal Propensity to Consume) rumah tangga = 0.68 berdasarkan estimasi dari data Susenas."],
        ["Limitasi Model",
         "Model ini bersifat indikatif. Multiplier diasumsikan konstan (model linear). Tidak ada efek harga endogen penuh. Tidak memperhitungkan expectation agent. Cocok untuk analisis shock kecil (&lt;10% output sektor). Untuk kebijakan besar, disarankan model GAMS/GEMPACK."],
      ]
    },
    link: {
      judul: "Analisis Keterkaitan Sektoral (Linkage Analysis)",
      sub: "Mengidentifikasi sektor kunci menggunakan matriks Leontief",
      isi: [
        ["Backward Linkage (BL)",
         "BL mengukur daya penyebaran ke belakang — seberapa besar sektor j menarik input dari sektor lain. BL_j = Σᵢ Lᵢⱼ (jumlah kolom j matriks Leontief). BL_norm = BL_j / mean(BL). Jika BL_norm > 1, sektor memiliki daya tarik input di atas rata-rata perekonomian."],
        ["Forward Linkage (FL)",
         "FL mengukur derajat kepekaan ke depan — seberapa penting sektor i sebagai pemasok ke sektor lain. FL_i = Σⱼ Lᵢⱼ (jumlah baris i matriks Leontief). FL_norm = FL_i / mean(FL). Jika FL_norm > 1, sektor merupakan pemasok penting bagi banyak sektor hilir."],
        ["Klasifikasi 4 Kuadran",
         "Kuadran I (BL>1, FL>1): Sektor KUNCI — prioritas kebijakan utama, efek berganda terbesar. Kuadran II (BL≤1, FL>1): Sektor PEMIMPIN — lokomotif hilirisasi. Kuadran III (BL>1, FL≤1): Sektor PENGIKUT — kuat menyerap input hulu. Kuadran IV (BL≤1, FL≤1): Sektor INDEPENDEN — terisolasi."],
        ["Multiplier Output",
         "Output multiplier = Σᵢ Lᵢⱼ = jumlah kolom j matriks Leontief = BL_j. Interpretasi: setiap Rp 1 peningkatan permintaan akhir di sektor j menghasilkan Rp multiplier total output di seluruh perekonomian. Multiplier > 2 dianggap tinggi untuk konteks Indonesia."],
      ]
    },
    mult: {
      judul: "Multiplier Output & Multiplier SAM",
      sub: "Dua jenis multiplier dengan cakupan berbeda",
      isi: [
        ["Multiplier Output (I-O)",
         "Multiplier output = jumlah kolom matriks Leontief L = (I-A)⁻¹. Hanya memasukkan efek langsung (direct) dan efek tidak langsung via input antara (indirect). Tidak memasukkan efek pendapatan RT. Umumnya lebih kecil dari multiplier SAM."],
        ["Multiplier SAM",
         "Multiplier SAM = (I-Sa)⁻¹ di mana Sa adalah matriks SAM yang dinormalisasi untuk akun endogen. Memasukkan efek langsung + tidak langsung + efek pendapatan (upah → konsumsi RT → output). Karena loop pendapatan ini, multiplier SAM > multiplier I-O."],
        ["Multiplier Pendapatan",
         "Income multiplier = va_ratio × (I-A)⁻¹, di mana va_ratio = rasio upah/output per sektor. Menunjukkan peningkatan pendapatan tenaga kerja per satuan permintaan akhir. Berguna untuk analisis distribusi pendapatan dan kemiskinan."],
        ["Multiplier Lapangan Kerja",
         "Employment multiplier = ej × (I-A)⁻¹, di mana ej = rasio tenaga kerja/output per sektor (dari Sakernas). Dalam platform ini, diestimasi kasar dari total TK berbanding total output. Untuk presisi lebih tinggi, diperlukan data TK per sektor yang lebih rinci."],
      ]
    },
    jenis: {
      judul: "Jenis Kebijakan & Mekanisme Transmisi",
      sub: "Setiap jenis kebijakan memiliki jalur transmisi, efisiensi, dan dampak yang berbeda",
      isi: [
        ["Investasi (multFactor=1.00)",
         "Masuk sebagai PMTB langsung ke sektor produksi. Multiplier Leontief penuh aktif (×1.00). Mendorong demand barang modal → backward linkage kuat. MPC=0.68, kebocoran impor 12%. Ini adalah kasus dasar (baseline) untuk pembanding."],
        ["Subsidi (multFactor=0.82)",
         "Mengurangi biaya produksi → harga konsumen turun, daya saing ekspor naik. Efisiensi 82% (18% deadweight loss) karena tidak semua subsidi masuk ke produksi — sebagian hilang sebagai keuntungan ekstra produsen/konsumen. MPC lebih tinggi (0.72) karena manfaat lebih besar ke RT miskin. Penerimaan pajak pemerintah turun (rate 1.5% vs 3% investasi)."],
        ["Ekspor (multFactor=1.08)",
         "Permintaan luar negeri naik → produsen meningkatkan output melebihi kapasitas normal. Multiplier lebih besar dari investasi (×1.08) karena ada efek valas masuk. Upah TK naik lebih signifikan (faktor 1.15) karena sektor ekspor umumnya padat karya. Impor input ikut naik (18%) karena bahan baku ekspor banyak diimpor."],
        ["Belanja Pemerintah (multFactor=0.90)",
         "G langsung masuk ke permintaan akhir. Efisiensi 90% (ada kebocoran birokrasi & impor material proyek 15%). Upah PNS dan sektor jasa naik lebih besar (faktor 1.10). Penerimaan pajak pemerintah TURUN (rate -1%) karena defisit anggaran bertambah — berbeda dari investasi swasta."],
        ["Pajak (multFactor=-0.75)",
         "Bersifat KONTRAKTIF — menarik uang dari RT dan bisnis. Output TURUN (multiplier negatif ×-0.75). Daya beli RT berkurang, konsumsi turun, MPC lebih rendah (0.60). Penerimaan pajak pemerintah NAIK besar (20% dari shock) — ini sumber pendapatan pemerintah. Digunakan untuk analisis dampak kenaikan pajak daerah."],
      ]
    },
    dekomp: {
      judul: "Dekomposisi Dampak Kebijakan (Linierisasi CGE)",
      sub: "Memisah total dampak menjadi 6 komponen berbeda — metodologi Sugema & Holis (2015) Bab 3-4",
      isi: [
        ["Efek Langsung (Direct) — D",
         "Injeksi permintaan awal ke sektor target. Besarnya = nilai shock (100%). Tidak bergantung pada elastisitas atau struktur I-O — ini adalah 'seed' yang memulai seluruh proses multiplier. Selalu positif untuk investasi/subsidi/ekspor/belanja, dan negatif untuk pajak."],
        ["Efek Tak Langsung (Indirect) — I",
         "Sektor hulu merespons peningkatan permintaan via rantai input-output. Besarnya ditentukan oleh Backward Linkage (BL) sektor target. Sektor dengan BL tinggi (misal Listrik/Gas BL=2.587) menghasilkan efek tak langsung yang sangat besar. Ini adalah 'putaran kedua' efek Leontief."],
        ["Efek Harga (Price) — P",
         "Produsen mengalihkan output antara pasar ekspor dan domestik (CET, σ=2.5), dan konsumen mensubstitusi impor dengan produksi domestik (Armington, σ=2.0). Makin tinggi σ, makin besar substitusi, makin besar efek harga. Subsidi menghasilkan efek harga negatif (harga turun)."],
        ["Efek Pendapatan-Konsumsi (Induced) — Y",
         "Upah faktor TK meningkat → pendapatan RT naik → RT meningkatkan konsumsi (MPC) → output meningkat lagi. Ini adalah 'putaran ketiga' atau 'induced effect'. Besarnya: incomeEff × MPC. Untuk pajak, efek ini negatif (pendapatan RT turun → konsumsi turun)."],
        ["Efek Fiskal — G",
         "Penerimaan pajak pemerintah berubah (positif untuk investasi/ekspor, negatif untuk belanja gov). Sebagian penerimaan ini diputar kembali ke ekonomi melalui belanja pemerintah — menciptakan efek berganda tambahan. Untuk pajak, efek fiskal sangat besar positif (itulah tujuan kebijakan pajak)."],
        ["Kebocoran Impor — M (negatif)",
         "Sebagian permintaan domestik yang tercipta dipenuhi oleh impor, bukan produksi domestik. Ini 'kebocoran' dari multiplier lokal. Makin tinggi σ_ARM (elastisitas Armington), makin mudah substitusi ke impor, makin besar kebocoran. Untuk ekonomi terbuka seperti kabupaten, kebocoran bisa 10-20%."],
      ]
    },
    les: {
      judul: "Model LES (Linear Expenditure System) / Stone-Geary",
      sub: "Fungsi konsumsi RT yang lebih realistis — memperhitungkan konsumsi minimum per komoditas",
      isi: [
        ["Mengapa LES lebih baik dari MPC Konstan?",
         "MPC konstan (misalnya 0.68) mengasumsikan setiap tambahan pendapatan selalu dialokasikan dengan proporsi yang sama untuk semua komoditas. LES lebih realistis: RT harus memenuhi konsumsi minimum (γ) dulu, baru sisa pendapatan (supernumerary income) dibagi sesuai preferensi marginal (β). Komoditas 'mewah' (η&gt;1) tumbuh lebih cepat dari rata-rata saat pendapatan naik."],
        ["Parameter: γ (Gamma) — Konsumsi Minimum",
         "Gamma (γ_i) adalah konsumsi subsisten minimum yang HARUS dipenuhi RT sebelum mengalokasikan sisa pendapatan. Untuk Rembang: γ_Makanan = Rp 3.050 M Jt (63% dari konsumsi makanan base). Semakin besar γ relatif terhadap C, semakin inelastis komoditas tersebut terhadap pendapatan."],
        ["Parameter: β (Beta) — Marginal Budget Share",
         "Beta (β_i) adalah proporsi dari supernumerary income yang dialokasikan ke komoditas i. Hubungan: β_i = η_i × w_i / Σ(η_j × w_j), di mana η adalah elastisitas pendapatan dan w adalah share anggaran. Syarat: Σβ_i = 1. Beta menentukan distribusi kenaikan konsumsi saat pendapatan naik."],
        ["Parameter: η (Eta) — Elastisitas Pendapatan",
         "Eta (η_i) mengklasifikasikan komoditas: η&lt;1 = kebutuhan pokok/inferior (Makanan η=0.72, Perumahan η=0.85); η&gt;1 = barang mewah/superior (Transportasi η=1.35, Kesehatan & Pddk η=1.20, Hotel η=1.15). Saat pendapatan naik, semua komoditas naik, tapi η&gt;1 naik LEBIH CEPAT dari rata-rata dan η&lt;1 naik LEBIH LAMBAT."],
        ["Formula LES dan Interpretasi",
         "C_i_new = γ_i + β_i × (Y_new − Σγ_j). Kalibrasi: γ_i = C_i_base − β_i × supernumerary_base (agar konsisten dengan data base). Supernumerary income = Y − Σγ_j adalah pendapatan 'bebas' setelah kebutuhan minimum terpenuhi. MPC efektif LES = ΔC_total/ΔY — bisa berbeda dari 0.68 tergantung struktur subsisten komoditas."],
      ]
    },
    ihpihk: {
      judul: "Indeks Harga Produsen (IHP) & Konsumen (IHK) Endogen",
      sub: "Estimasi dampak inflasi dari shock kebijakan — Sugema & Holis (2015) Persamaan 5.51 & 5.54",
      isi: [
        ["Mengapa Harga Endogen Penting?",
         "Model CGE sederhana sering mengasumsikan harga tetap. Dalam kenyataan, shock kebijakan mengubah harga melalui dua jalur: (1) Sisi penawaran — output naik → harga cenderung turun (supply-push deflation); (2) Sisi permintaan — pendapatan RT naik → konsumsi naik → harga cenderung naik (demand-pull inflation). Platform menghitung keduanya secara simultan."],
        ["IHP — Indeks Harga Produsen",
         "IHP = Σ(w_j × ΔP_j) di mana w_j adalah bobot sektor produsen (Pertanian 22%, Industri 24%, Jasa 34%, dll.) dan ΔP_j = −ε_s × ΔOutput_j + ε_d × ΔGDP. Saat investasi industri besar naik → output industri naik → IHP turun (supply deflasi). Berbeda dari IHK yang dari sisi konsumen."],
        ["IHK — Indeks Harga Konsumen",
         "IHK = Σ(w_i × ΔP_i) di mana w_i adalah bobot komoditas konsumsi (Makanan 46.5%, Transportasi 25.4%, dll.). ΔP_i dihitung dari rata-rata output sektor yang memproduksi komoditas tersebut. IHK langsung mempengaruhi daya beli RT: kenaikan IHK menggerus pendapatan riil."],
        ["Parameter Elastisitas Harga",
         "ε_s = 0.30 (invers elastisitas penawaran): dP/P = −0.30 × dQ/Q. Artinya kenaikan output 10% menurunkan harga 3%. ε_d = 0.20 (elastisitas inflasi permintaan): dP/P = 0.20 × ΔGDP%. Nilai ini estimasi standar untuk ekonomi Indonesia — kalibrasi lokal dengan data harga BPS akan meningkatkan akurasi."],
        ["Pendapatan Riil dan Spread IHP-IHK",
         "Pendapatan Riil RT = Δ Pendapatan Nominal − Δ IHK. Jika pendapatan naik +2% tapi IHK naik +1.5%, daya beli RT hanya naik +0.5% secara riil. Spread IHP−IHK: jika IHP < IHK, produsen menikmati harga output yang turun lebih sedikit dari kenaikan harga yang dibayar konsumen — margin produsen terjepit."],
      ]
    },
    interp: {
      judul: "Panduan Interpretasi Hasil Simulasi",
      sub: "Cara membaca dan menggunakan output analisis CGE",
      isi: [
        ["Membaca Multiplier",
         "Multiplier = 1.777 artinya: setiap Rp 1 Triliun investasi/subsidi di sektor ini menciptakan total Rp 1.777 Triliun output perekonomian. Output tambahan (Rp 0.777 T) adalah efek berantai ke sektor-sektor lain. Semakin tinggi multiplier, semakin efisien kebijakan tersebut dalam menggerakkan ekonomi."],
        ["Membaca BL dan FL",
         "BL_norm = 1.5 artinya daya tarik input sektor ini 50% di atas rata-rata. Jika FL juga tinggi, sektor berposisi sebagai hub ekonomi. Sektor pertambangan Rembang (FL=3.26) berarti sangat penting sebagai bahan baku industri — gangguan di sektor ini berdampak luas ke hilir."],
        ["Interpretasi Kuadran",
         "Sektor Kunci (I): terbaik untuk injeksi kebijakan karena dampak ke depan dan belakang sama besar. Sektor Pemimpin (II): cocok untuk kebijakan ekspor/hilirisasi. Sektor Pengikut (III): cocok untuk kebijakan pengembangan industri hulu. Sektor Independen (IV): perlu penguatan linkage dulu."],
        ["Membaca Dekomposisi Dampak",
         "Efek Langsung (~56%): output sektor target langsung meningkat. Efek Tidak Langsung (~22%): supplier sektor target ikut meningkat output. Efek Pendapatan/Induced (~18%): upah meningkat → konsumsi RT naik → output meningkat lagi. Kebocoran Impor (~12%): sebagian permintaan dipenuhi impor, tidak memberi dampak lokal."],
        ["Catatan Kehati-hatian",
         "Hasil analisis bersifat INDIKATIF — cocok untuk peringkat/prioritas kebijakan, bukan prediksi angka presisi. Multiplier konstan (model linear) — berlaku untuk shock kecil (&lt;10% output). Elastisitas dari literatur nasional, bukan kalibrasi lokal. Selalu lakukan uji sensitivitas dan bandingkan dengan kajian lapangan."],
      ]
    },
  };

  const topik = konten[aktif]||konten.io;
  const akcentColors = {io:"#22c55e",ras:"#0ea5e9",sam:"#8b5cf6",cge:"#ec4899",link:"#f97316",mult:"#f59e0b",jenis:"#f97316",dekomp:"#22c55e",les:"#0ea5e9",ihpihk:"#f59e0b",interp:"#06b6d4"};
  const ac = akcentColors[aktif]||"#22c55e";

  return (
    <div>
      <Sec title="📚 Metodologi & Cara Interpretasi" accent="#22c55e"
        sub="Penjelasan lengkap semua metode yang digunakan platform — dari regionalisasi I-O hingga cara membaca hasil simulasi.">
        <div style={{display:"flex",gap:7,marginBottom:20,flexWrap:"wrap"}}>
          {menus.map(([k,l])=>(
            <Chip key={k} active={aktif===k} onClick={()=>setAktif(k)} color={akcentColors[k]||"#22c55e"}>{l}</Chip>
          ))}
        </div>
        <div style={{...card,borderTop:`3px solid ${ac}`}}>
          <div style={{fontSize:15,fontWeight:700,color:"#f1f5f9",marginBottom:4}}>{topik.judul}</div>
          <div style={{fontSize:12,color:"#64748b",marginBottom:16}}>{topik.sub}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            {topik.isi.map(([judul,penjelasan],i)=>(
              <div key={i} style={{background:"#0a1628",borderRadius:8,padding:"12px 14px",
                borderLeft:`3px solid ${ac}`}}>
                <div style={{fontSize:12,fontWeight:700,color:ac,marginBottom:6}}>{judul}</div>
                <div style={{fontSize:11,color:"#94a3b8",lineHeight:1.7}}>{penjelasan}</div>
              </div>
            ))}
          </div>
        </div>

        {aktif==="interp"&&(
          <div style={{marginTop:14,...card,background:"#0a1628",borderLeft:"3px solid #06b6d4"}}>
            <div style={{fontSize:13,fontWeight:700,color:"#06b6d4",marginBottom:12}}>
              📋 Tabel Panduan Cepat Interpretasi
            </div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead>
                <tr style={{background:"#1e293b"}}>
                  {["Indikator","Nilai Rendah","Nilai Sedang","Nilai Tinggi","Rekomendasi"].map(h=>(
                    <th key={h} style={{padding:"8px 10px",textAlign:"left",color:"#64748b",...mono,fontSize:10,borderBottom:"1px solid #334155"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Multiplier Output","< 1.5","1.5 – 2.0","> 2.0","Prioritaskan sektor multiplier tinggi untuk efisiensi fiskal"],
                  ["BL Norm","< 0.8","0.8 – 1.2","> 1.2","BL tinggi = sektor menyerap banyak input lokal → kurangi impor"],
                  ["FL Norm","< 0.8","0.8 – 1.2","> 1.2","FL tinggi = kunci rantai nilai → investasi berdampak luas"],
                  ["VA/Output","< 30%","30% – 60%","> 60%","VA tinggi = lebih banyak nilai tambah lokal, kurang impor input"],
                  ["Dampak PDRB","+< 0.5%","+0.5% – 1%","+> 1%","Dampak > 1% PDRB dari satu proyek = sangat signifikan"],
                  ["TPT","< 2%","2% – 5%","> 5%","TPT > 5% = perlu kebijakan penciptaan lapangan kerja segera"],
                ].map(([ind,r,s,t,rek],i)=>(
                  <tr key={i} style={{borderBottom:"1px solid #1e293b",background:i%2===0?"#0f172a":"#0a1628"}}>
                    <td style={{padding:"7px 10px",color:"#f1f5f9",fontWeight:600}}>{ind}</td>
                    <td style={{padding:"7px 10px",color:"#ef4444",fontSize:10}}>{r}</td>
                    <td style={{padding:"7px 10px",color:"#f59e0b",fontSize:10}}>{s}</td>
                    <td style={{padding:"7px 10px",color:"#22c55e",fontSize:10}}>{t}</td>
                    <td style={{padding:"7px 10px",color:"#94a3b8",fontSize:10}}>{rek}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {aktif==="ras"&&(
          <div style={{marginTop:14,...card,background:"#0a1628"}}>
            <div style={{fontSize:11,color:"#0ea5e9",...mono,marginBottom:8}}>PSEUDOCODE ALGORITMA RAS</div>
            <div style={{background:"#020817",borderRadius:8,padding:"12px 16px",fontSize:11,...mono,color:"#22c55e",lineHeight:1.8}}>
              <span style={{color:"#f59e0b"}}>Input:</span> Z_ref (matriks I-O referensi n×n), u (target baris), v (target kolom)<br/>
              <span style={{color:"#f59e0b"}}>Output:</span> Z_target (matriks I-O daerah target)<br/>
              <br/>
              Z = Z_ref.copy()<br/>
              <span style={{color:"#8b5cf6"}}>while</span> max_error &gt; 0.01% <span style={{color:"#8b5cf6"}}>and</span> iter &lt; 2000:<br/>
              <span style={{color:"#64748b",marginLeft:24}}>{"  "}# Langkah R — skalasi baris</span><br/>
              <span style={{marginLeft:24}}>{"  "}r = u / Z.sum(axis=1)  <span style={{color:"#475569"}}># ratio target vs aktual</span></span><br/>
              <span style={{marginLeft:24}}>{"  "}Z = diag(r) × Z</span><br/>
              <span style={{color:"#64748b",marginLeft:24}}>{"  "}# Langkah S — skalasi kolom</span><br/>
              <span style={{marginLeft:24}}>{"  "}s = v / Z.sum(axis=0)</span><br/>
              <span style={{marginLeft:24}}>{"  "}Z = Z × diag(s)</span><br/>
              <span style={{marginLeft:24}}>{"  "}error = max(|Z.sum(axis=1)−u|, |Z.sum(axis=0)−v|)</span><br/>
              <br/>
              <span style={{color:"#f59e0b"}}>return</span> Z  <span style={{color:"#475569"}}># Matriks I-O daerah target</span>
            </div>
          </div>
        )}
      </Sec>
    </div>
  );
}


// ─────────────────────────────────────────────
// KOMPONEN MATRIKS TRANSAKSI I-O (Z & A)
// ─────────────────────────────────────────────
function MatriksIO({ ioMatrix, defaultMode }) {
  const [viewMode,    setViewMode]    = useState(defaultMode||"Z");
  const [showAll,     setShowAll]     = useState(false);
  const [hRow,        setHRow]        = useState(null);
  const [hCol,        setHCol]        = useState(null);

  const mtx   = ioMatrix || IO_MATRIX;
  const q23   = IO_Q2Q3;
  const names = mtx ? mtx.names : [];
  const n     = names.length;
  const displayN = showAll ? n : Math.min(15, n);

  if (!mtx || !n) return (
    <div style={{...card,color:"#64748b",textAlign:"center",padding:40}}>Data matriks tidak tersedia</div>
  );

  // Helper heatmap color
  const allZ    = (mtx.Z||[]).flat().filter(v=>v>0);
  const maxZ    = allZ.length ? Math.max(...allZ) : 1;
  const heatZ   = (v) => {
    if (!v || v<=0) return "transparent";
    const t = Math.min(1, v / (maxZ * 0.35));
    return `rgba(${Math.round(34+(239-34)*(1-t))},${Math.round(197+(68-197)*(1-t))},${Math.round(94+(68-94)*(1-t))},${0.12+t*0.65})`;
  };
  const allA = (mtx.A||[]).flat().filter(v=>v>0);
  const maxA = allA.length ? Math.max(...allA) : 1;
  const heatA = (v) => {
    if (!v||v<=0) return "transparent";
    const t = Math.min(1, v/maxA);
    return `rgba(14,${Math.round(165+(68-165)*(1-t))},${Math.round(233+(68-233)*(1-t))},${0.15+t*0.65})`;
  };
  const heatFA = (v, maxV) => {
    if (!v||v<=0) return "transparent";
    const t = Math.min(1, v/maxV*2);
    return `rgba(139,92,${Math.round(246+(68-246)*(1-t))},${0.12+t*0.55})`;
  };
  const heatQ3 = (v, maxV) => {
    if (!v||v<=0) return "transparent";
    const t = Math.min(1, v/maxV*2);
    return `rgba(249,${Math.round(115+(68-115)*(1-t))},22,${0.12+t*0.55})`;
  };

  const maxFA  = q23 ? Math.max(...(q23.FA||[1]).filter(v=>v>0), 1) : 1;
  const maxVA  = q23 ? Math.max(...(q23.VA||[1]).filter(v=>v>0), 1) : 1;

  const fmtV = (v, mode) => {
    if (!v||v===0) return "";
    if (mode==="A") return v>=0.001 ? v.toFixed(3) : "";
    return v>=1000000 ? (v/1000000).toFixed(1)+"M"
         : v>=1000   ? (v/1000).toFixed(0)+"K"
         : Math.round(v)+"";
  };

  // Tombol download
  const dlFull = () => {
    const sep = ",";
    const q23d = IO_Q2Q3 || {};
    const hdr = ["Sektor",...names,"Kons.RT","Konsumsi Gov","Investasi","Ekspor","TOTAL FA","TOTAL OUTPUT"].join(sep);
    const rows = (mtx.Z||[]).map((row,i)=>[
      '"'+names[i]+'"',
      ...row.map(v=>v||0),
      Math.round(q23d.C?.[i]||0), Math.round(q23d.G?.[i]||0),
      Math.round(q23d.I?.[i]||0), Math.round(q23d.E?.[i]||0),
      Math.round(q23d.FA?.[i]||0), Math.round(q23d.X?.[i]||0),
    ].join(sep));
    // Baris pemisah
    rows.push(Array(names.length+7).fill("").join(sep));
    // Kuadran 3
    rows.push(["Upah & Gaji",...(q23d.W||[]).map(v=>Math.round(v||0)),"","","","","",""].join(sep));
    rows.push(["Surplus Usaha",...(q23d.S||[]).map(v=>Math.round(v||0)),"","","","","",""].join(sep));
    rows.push(["Pajak Neto",...(q23d.tax||[]).map(v=>Math.round(v||0)),"","","","","",""].join(sep));
    rows.push(["Nilai Tambah",...(q23d.VA||[]).map(v=>Math.round(v||0)),"","","","","",""].join(sep));
    rows.push(["Impor",...(q23d.M||[]).map(v=>Math.round(v||0)),"","","","","",""].join(sep));
    rows.push(["TOTAL INPUT",...(q23d.X||[]).map(v=>Math.round(v||0)),"","","","","",""].join(sep));
    const csv = "# Tabel Input-Output Kabupaten Rembang 2016 - LENGKAP (4 Kuadran)\n"
      +"# Kuadran 1: Transaksi Antara (Z) | Kuadran 2: Permintaan Akhir | Kuadran 3: Input Primer\n"
      +"# Satuan: Juta Rupiah ADHP | Sumber: Platform CGE Indonesia v2.0\n\n"
      +[hdr,...rows].join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8,\uFEFF"+encodeURIComponent(csv);
    a.download = "Tabel_IO_Lengkap_Rembang_2016.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const dlZ = () => {
    const sep=",";
    const hdr=["Sektor",...names,"Total Baris"].join(sep);
    const rows=(mtx.Z||[]).map((row,i)=>['"'+names[i]+'"',...row.map(v=>v||0),row.reduce((a,b)=>a+(b||0),0)].join(sep));
    const q23d=IO_Q2Q3||{};
    rows.push(["Upah & Gaji",...(q23d.W||[]).map(v=>Math.round(v||0)),"","","","","",""].join(sep));
    rows.push(["Surplus Usaha",...(q23d.S||[]).map(v=>Math.round(v||0)),"","","","","",""].join(sep));
    rows.push(["Nilai Tambah",...(q23d.VA||[]).map(v=>Math.round(v||0)),"","","","","",""].join(sep));
    rows.push(["Impor",...(q23d.M||[]).map(v=>Math.round(v||0)),"","","","","",""].join(sep));
    rows.push(["Total Input",...(q23d.X||[]).map(v=>Math.round(v||0)),""].join(sep));
    const csv="# Tabel IO Rembang 2016 - Matriks Z\n\n"+[hdr,...rows].join("\n");
    const a=document.createElement("a");
    a.href="data:text/csv;charset=utf-8,\uFEFF"+encodeURIComponent(csv);
    a.download="Matriks_Z_IO_Rembang_2016.csv";
    document.body.appendChild(a);a.click();document.body.removeChild(a);
  };

  const dlA = () => {
    const sep=",";
    const hdr=["Sektor",...names].join(sep);
    const rows=(mtx.A||[]).map((row,i)=>['"'+names[i]+'"',...row.map(v=>(v||0).toFixed(4))].join(sep));
    const csv="# Matriks Koefisien Teknis A = Z/X - Rembang 2016\n\n"+[hdr,...rows].join("\n");
    const a=document.createElement("a");
    a.href="data:text/csv;charset=utf-8,\uFEFF"+encodeURIComponent(csv);
    a.download="Matriks_A_Rembang_2016.csv";
    document.body.appendChild(a);a.click();document.body.removeChild(a);
  };

  const thStyle = (isHL) => ({
    padding:"6px 4px", textAlign:"center", fontSize:8, ...mono,
    color: isHL ? "#22c55e" : "#475569",
    borderBottom:"1px solid #334155",
    minWidth:52, cursor:"pointer",
    writingMode:"vertical-rl", transform:"rotate(180deg)",
    height:90, verticalAlign:"bottom",
    background: isHL ? "#0f2d1a" : "#0a1628",
    transition:"background 0.15s",
  });

  const tdStyle = (v, bgFn, isHL, isDiag) => ({
    padding:"3px 4px", textAlign:"right", fontSize:8, ...mono,
    background: bgFn(v),
    border: isDiag ? "1px solid #334155" : "none",
    color: isHL ? "#f8fafc" : v > 0 ? "#e2e8f0" : "#1e293b",
    fontWeight: v > maxZ * 0.15 ? "700" : "400",
    minWidth:50,
  });

  // Header kolom FA (kuadran 2)
  const FA_LABELS = ["Kons. RT","Gov","Investasi","Ekspor","TOTAL FA"];
  const FA_COLORS = ["#8b5cf6","#06b6d4","#f97316","#ec4899","#22c55e"];

  return (
    <div>
      {/* Kontrol bar */}
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:11,color:"#64748b",...mono}}>Tampilkan:</span>
          {[["full","Tabel Lengkap (4 Kuadran)"],["Z","Matriks Z"],["A","Koefisien A"]].map(([k,l])=>(
            <Chip key={k} active={viewMode===k} onClick={()=>setViewMode(k)} color={k==="full"?"#22c55e":k==="Z"?"#0ea5e9":"#f59e0b"}>{l}</Chip>
          ))}
          <button onClick={()=>setShowAll(v=>!v)}
            style={{padding:"4px 12px",borderRadius:20,border:"1px solid #334155",background:"transparent",color:"#64748b",fontSize:11,cursor:"pointer"}}>
            {showAll ? "≤15 Sektor":"Semua "+n+" Sektor"}
          </button>
        </div>
        <div style={{display:"flex",gap:7}}>
          <button onClick={dlFull} style={{padding:"5px 13px",borderRadius:7,border:"none",background:"#22c55e",color:"#0f172a",cursor:"pointer",fontSize:11,fontWeight:700}}>
            ⬇ Tabel Lengkap (.csv)
          </button>
          <button onClick={dlZ} style={{padding:"5px 13px",borderRadius:7,border:"none",background:"#0ea5e9",color:"#fff",cursor:"pointer",fontSize:11,fontWeight:700}}>
            ⬇ Matriks Z
          </button>
          <button onClick={dlA} style={{padding:"5px 13px",borderRadius:7,border:"none",background:"#f59e0b",color:"#0f172a",cursor:"pointer",fontSize:11,fontWeight:700}}>
            ⬇ Koefisien A
          </button>
        </div>
      </div>

      {/* Keterangan kuadran */}
      {viewMode==="full" && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
          {[
            ["📊 Kuadran I","Transaksi Antara (Z)","Baris i, Kolom j = output sektor i yang dibeli sektor j sebagai input. Heatmap hijau.","#22c55e"],
            ["📋 Kuadran II","Permintaan Akhir","Kolom C (konsumsi RT), G (pemerintah), I (investasi), E (ekspor). Heatmap ungu.","#8b5cf6"],
            ["🏗️ Kuadran III","Input Primer","Baris W (upah), S (surplus), VA, M (impor). Heatmap oranye.","#f97316"],
          ].map(([icon,title,desc,color])=>(
            <div key={title} style={{background:"#0a1628",borderRadius:8,padding:"9px 12px",borderLeft:`2px solid ${color}`}}>
              <div style={{fontSize:11,fontWeight:700,color,marginBottom:3}}>{icon} {title}</div>
              <div style={{fontSize:10,color:"#64748b",lineHeight:1.5}}>{desc}</div>
            </div>
          ))}
        </div>
      )}

      {/* TABEL MATRIKS */}
      <div style={{...card,overflow:"auto",padding:0}}>
        <table style={{borderCollapse:"collapse",fontSize:9,...mono,minWidth:"max-content"}}>
          {/* HEADER */}
          <thead>
            <tr style={{background:"#0a1628",position:"sticky",top:0,zIndex:10}}>
              {/* Label pojok kiri atas */}
              <th style={{padding:"8px 10px",textAlign:"left",color:"#64748b",fontSize:9,
                borderRight:"2px solid #334155",borderBottom:"1px solid #334155",
                minWidth:140,position:"sticky",left:0,background:"#0a1628",zIndex:11,whiteSpace:"nowrap"}}>
                {viewMode==="A"?"Matriks A (koef)":viewMode==="Z"?"Matriks Z (Juta Rp)":"Tabel I-O 4 Kuadran"}
              </th>
              {/* Kuadran 1 header — sektor */}
              {names.slice(0,displayN).map((nm,j)=>(
                <th key={j} style={thStyle(hCol===j)}
                  onMouseEnter={()=>setHCol(j)} onMouseLeave={()=>setHCol(null)}>
                  {j+1}.{nm.slice(0,11)}
                </th>
              ))}
              {/* Kuadran 2 header — FA */}
              {viewMode==="full" && FA_LABELS.map((l,j)=>(
                <th key={"fa"+j} style={{...thStyle(false),color:FA_COLORS[j],
                  borderLeft: j===0?"2px solid #334155":"none",
                  background: j===FA_LABELS.length-1?"#0f2d1a":"#0a1628",
                  fontWeight: j===FA_LABELS.length-1?"800":"600"}}>
                  {l}
                </th>
              ))}
              {/* Total Output header */}
              <th style={{...thStyle(false),color:"#f8fafc",fontWeight:800,
                borderLeft:"2px solid #334155",background:"#030d1f"}}>
                TOTAL OUTPUT
              </th>
            </tr>
          </thead>

          {/* BODY — baris sektor (Kuadran 1 + 2) */}
          <tbody>
            {names.slice(0,displayN).map((nm,i)=>{
              const rowZ  = (mtx.Z||[])[i] || [];
              const isHL  = hRow===i;
              const rowSum = rowZ.slice(0,displayN).reduce((a,b)=>a+(b||0),0);
              return (
                <tr key={i} style={{background: isHL?"#0f2d1a": i%2===0?"#0f172a":"#0a1628"}}
                  onMouseEnter={()=>setHRow(i)} onMouseLeave={()=>setHRow(null)}>
                  {/* Label baris */}
                  <td style={{padding:"4px 10px",color:"#e2e8f0",fontWeight:500,fontSize:10,
                    borderRight:"2px solid #1e293b",
                    position:"sticky",left:0,whiteSpace:"nowrap",
                    background: isHL?"#0f2d1a": i%2===0?"#0f172a":"#0a1628",zIndex:5}}>
                    <span style={{color:"#475569",marginRight:4}}>{i+1}.</span>
                    {nm.slice(0,20)}
                  </td>
                  {/* Kuadran 1 — sel Z */}
                  {rowZ.slice(0,displayN).map((v,j)=>(
                    <td key={j}
                      title={names[i]+" → "+names[j]+": Rp "+(v||0).toLocaleString("id-ID")+" Jt"}
                      style={{...tdStyle(v||0, viewMode==="A"?heatA:heatZ, isHL||hCol===j, i===j),
                        background: viewMode==="A" ? heatA((mtx.A||[])[i]?.[j]||0) : heatZ(v||0)}}>
                      {fmtV(viewMode==="A" ? ((mtx.A||[])[i]?.[j]||0) : (v||0), viewMode)}
                    </td>
                  ))}
                  {/* Kuadran 2 — FA */}
                  {viewMode==="full" && q23 && [
                    q23.C?.[i]||0, q23.G?.[i]||0, q23.I?.[i]||0, q23.E?.[i]||0, q23.FA?.[i]||0
                  ].map((v,j)=>(
                    <td key={"fa"+j}
                      title={FA_LABELS[j]+": Rp "+(v||0).toLocaleString("id-ID")+" Jt"}
                      style={{padding:"3px 4px",textAlign:"right",fontSize:8,...mono,
                        background: heatFA(v, maxFA),
                        borderLeft: j===0?"2px solid #1e293b":"none",
                        color: v>0?"#c4b5fd":"#1e293b",
                        fontWeight: j===4?"800":"400",
                        background: j===4?"#0d1b35":heatFA(v,maxFA),
                        color: j===4?(v>0?"#22c55e":"#1e293b"):(v>0?"#c4b5fd":"#1e293b"),
                        minWidth:52}}>
                      {fmtV(v,"Z")}
                    </td>
                  ))}
                  {/* Total output (X) */}
                  <td style={{padding:"4px 6px",textAlign:"right",fontSize:9,...mono,
                    fontWeight:800,color:"#f8fafc",
                    borderLeft:"2px solid #334155",
                    background:"#030d1f"}}>
                    {fmtV(q23?.X?.[i]||0,"Z")}
                  </td>
                </tr>
              );
            })}

            {/* PEMISAH antar kuadran */}
            <tr>
              <td colSpan={displayN + (viewMode==="full"?7:2)}
                style={{height:6,background:"#334155",padding:0}}/>
            </tr>

            {/* Kuadran 3 — Input Primer */}
            {(viewMode==="full"||viewMode==="Z") && q23 && [
              ["Upah & Gaji",    q23.W,  "#0ea5e9", false],
              ["Surplus Usaha",  q23.S,  "#f59e0b", false],
              ["Pajak Neto",     q23.tax,"#64748b", false],
              ["Nilai Tambah (VA)", q23.VA, "#22c55e", true],
              ["Impor",          q23.M,  "#ef4444", false],
            ].map(([lbl, arr, color, bold])=>{
              const rowSum = (arr||[]).slice(0,displayN).reduce((a,b)=>a+(b||0),0);
              return (
                <tr key={lbl} style={{background:"#030d1f",borderTop:"1px solid #1e293b"}}>
                  <td style={{padding:"5px 10px",color:color,fontWeight:bold?800:600,
                    fontSize:10,borderRight:"2px solid #1e293b",
                    position:"sticky",left:0,background:"#030d1f",whiteSpace:"nowrap",zIndex:5}}>
                    {lbl}
                  </td>
                  {(arr||[]).slice(0,displayN).map((v,j)=>(
                    <td key={j} style={{padding:"3px 4px",textAlign:"right",fontSize:8,...mono,
                      color: v>0?color:v<0?"#ef4444":"#1e293b",
                      fontWeight: bold?"700":"400",
                      background: heatQ3(Math.abs(v||0), maxVA)}}>
                      {v!==0?fmtV(Math.abs(v||0),"Z"):""}
                    </td>
                  ))}
                  {viewMode==="full" && <td colSpan={5}
                    style={{padding:"3px 4px",borderLeft:"2px solid #1e293b"}}/>}
                  <td style={{padding:"4px 6px",textAlign:"right",fontSize:9,...mono,
                    fontWeight:800,color:color,borderLeft:"2px solid #334155",background:"#030d1f"}}>
                    {fmtV(rowSum,"Z")}
                  </td>
                </tr>
              );
            })}

            {/* Baris Total Input (X) */}
            {(viewMode==="full"||viewMode==="Z") && q23 && (
              <tr style={{background:"#0a1628",borderTop:"2px solid #334155"}}>
                <td style={{padding:"5px 10px",color:"#f8fafc",fontWeight:800,
                  fontSize:10,borderRight:"2px solid #1e293b",
                  position:"sticky",left:0,background:"#0a1628",whiteSpace:"nowrap",zIndex:5}}>
                  TOTAL INPUT
                </td>
                {(q23.X||[]).slice(0,displayN).map((v,j)=>(
                  <td key={j} style={{padding:"3px 4px",textAlign:"right",fontSize:8,...mono,
                    color:"#f8fafc",fontWeight:700}}>
                    {fmtV(v||0,"Z")}
                  </td>
                ))}
                {viewMode==="full" && <td colSpan={5} style={{borderLeft:"2px solid #1e293b"}}/>}
                <td style={{padding:"4px 6px",textAlign:"right",fontSize:10,...mono,
                  fontWeight:800,color:"#f8fafc",borderLeft:"2px solid #334155",background:"#030d1f"}}>
                  {fmtV((q23.X||[]).slice(0,displayN).reduce((a,b)=>a+(b||0),0),"Z")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Legenda */}
      <div style={{display:"flex",gap:14,flexWrap:"wrap",marginTop:10,fontSize:10,color:"#64748b",alignItems:"center"}}>
        {viewMode==="full"&&<>
          {[["#22c55e","Kuadran I (Z)"],["#8b5cf6","Kuadran II (FA)"],["#f97316","Kuadran III (NTB)"]].map(([c,l])=>(
            <div key={l} style={{display:"flex",alignItems:"center",gap:5}}>
              <div style={{width:12,height:12,borderRadius:2,background:c+"40",border:`1px solid ${c}`}}/>
              <span>{l}</span>
            </div>
          ))}
        </>}
        <span style={{color:"#475569"}}>Hover sel = nilai detail · Hover header = highlight kolom</span>
        <span style={{color:"#475569"}}>Warna = intensitas nilai (lebih gelap = lebih besar)</span>
      </div>
    </div>
  );
}



// ═══════════════════════════════════════════════════════════════
// FITUR 1 — DEKOMPOSISI DAMPAK KEBIJAKAN
// ═══════════════════════════════════════════════════════════════
function DekomposisiDampak({ result, params }) {
  if (!result) return null;
  const { shock, total, direct, incomeEff, consumpEff, roundOne, roundTwo, govRevEff, s } = result;
  const { sigmaArm, sigmaCet, mpc } = params;

  // Hitung ulang komponen dekomposisi berdasarkan parameter aktual
  const multLeontief = s.mult;
  const directEff    = shock;                                    // D — Efek Langsung
  const indirectEff  = shock * (multLeontief - 1) * 0.65;       // I — Efek Tak Langsung (Backward)
  const priceEff     = shock * (multLeontief - 1) * 0.12        // P — Efek Harga (CET/CES)
                       * (sigmaCet / 2.5);
  const inducedEff   = shock * (s.ntb / s.output) * mpc * 0.68; // Y — Efek Pendapatan-Konsumsi
  const importLeakage= shock * 0.12 * (sigmaArm / 2.0);         // M — Kebocoran Impor
  const govTaxEff    = govRevEff;                                // G — Efek Fiskal

  const total_decomp = directEff + indirectEff + priceEff + inducedEff - importLeakage + govTaxEff;

  const components = [
    { label: "Efek Langsung (Direct)",         symbol: "D", val: directEff,    color: "#22c55e",
      desc: "Injeksi permintaan awal ke sektor target. Tidak bergantung elastisitas — ini adalah shock yang ditetapkan." },
    { label: "Efek Tak Langsung (Indirect)",   symbol: "I", val: indirectEff,  color: "#0ea5e9",
      desc: `Sektor hulu merespons peningkatan permintaan. Ditentukan oleh struktur I-O (BL norm = ${s.bl_n.toFixed(3)}).` },
    { label: "Efek Harga (CET/CES)",           symbol: "P", val: priceEff,     color: "#8b5cf6",
      desc: `Produsen mengalihkan output ekspor↔domestik (σ_CET=${sigmaCet.toFixed(1)}), konsumen substitusi impor↔domestik (σ_ARM=${sigmaArm.toFixed(1)}).` },
    { label: "Efek Pendapatan–Konsumsi",       symbol: "Y", val: inducedEff,   color: "#f59e0b",
      desc: `Upah naik → RT meningkatkan konsumsi (MPC=${mpc.toFixed(2)}). Efek berganda putaran kedua.` },
    { label: "Efek Fiskal (Pajak+Transfer)",   symbol: "G", val: govTaxEff,    color: "#06b6d4",
      desc: "Penerimaan pajak pemerintah meningkat. Sebagian kembali ke ekonomi melalui belanja pemerintah." },
    { label: "(−) Kebocoran Impor",            symbol: "M", val: -importLeakage, color: "#ef4444",
      desc: `Sebagian permintaan dipenuhi impor (σ_ARM=${sigmaArm.toFixed(1)}). Semakin tinggi σ_ARM, semakin besar kebocoran.` },
  ];

  const maxAbs = Math.max(...components.map(c => Math.abs(c.val)));

  return (
    <div style={{...card}}>
      <div style={{fontSize:11,color:"#64748b",...mono,marginBottom:14}}>
        DEKOMPOSISI DAMPAK (Sugema & Holis, 2015 — Linierisasi Model CGE)
      </div>

      {/* Waterfall chart */}
      <div style={{marginBottom:14}}>
        {components.map((c,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
            {/* Symbol */}
            <div style={{width:24,height:24,borderRadius:"50%",background:`${c.color}22`,
              border:`1px solid ${c.color}`,display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:10,fontWeight:700,color:c.color,flexShrink:0,...mono}}>
              {c.symbol}
            </div>
            {/* Label */}
            <div style={{width:200,fontSize:11,color:c.val<0?"#ef4444":"#e2e8f0",flexShrink:0}}
              title={c.desc}>{c.label}</div>
            {/* Bar */}
            <div style={{flex:1,height:18,background:"#1e293b",borderRadius:3,position:"relative",overflow:"hidden"}}>
              <div style={{
                position:"absolute",
                left: c.val>=0 ? 0 : `${50 + (c.val/maxAbs)*50}%`,
                width: `${Math.abs(c.val)/maxAbs * (c.val>=0?100:50)}%`,
                height:"100%",background:c.color,borderRadius:3,transition:"width 0.5s",opacity:0.85
              }}/>
            </div>
            {/* Value */}
            <div style={{width:80,textAlign:"right",fontSize:10,...mono,
              color:c.val<0?"#ef4444":c.color,fontWeight:600}}>
              {c.val>=0?"+":""}{(c.val/1000).toFixed(0)} M
            </div>
          </div>
        ))}
        {/* Total */}
        <div style={{borderTop:"1px solid #334155",paddingTop:8,display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
          <span style={{fontSize:12,fontWeight:700,color:"#f8fafc"}}>Total Dampak Bersih</span>
          <span style={{fontSize:13,fontWeight:800,color:"#22c55e",...mono}}>
            Rp {fmt(Math.round(total_decomp))} Jt (×{s.mult.toFixed(3)})
          </span>
        </div>
      </div>

      {/* Narasi dekomposisi */}
      <div style={{background:"#0a1628",borderRadius:8,padding:"10px 14px",fontSize:11,color:"#94a3b8",lineHeight:1.8}}>
        <strong style={{color:"#f1f5f9"}}>Membaca dekomposisi:</strong>{" "}
        Dari total dampak Rp {fmt(Math.round(total_decomp))} Juta,{" "}
        sekitar <strong style={{color:"#22c55e"}}>{(directEff/total_decomp*100).toFixed(0)}%</strong> adalah efek langsung,{" "}
        <strong style={{color:"#0ea5e9"}}>{(indirectEff/total_decomp*100).toFixed(0)}%</strong> efek tak langsung via rantai input-output,{" "}
        <strong style={{color:"#f59e0b"}}>{(inducedEff/total_decomp*100).toFixed(0)}%</strong> efek pendapatan-konsumsi RT,{" "}
        dan <strong style={{color:"#ef4444"}}>{(importLeakage/total_decomp*100).toFixed(0)}%</strong> bocor ke impor.
        {" "}Komponen harga (CET/CES) menyumbang{" "}
        <strong style={{color:"#8b5cf6"}}>{(priceEff/total_decomp*100).toFixed(0)}%</strong>.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FITUR 2 — SENSITIVITY ANALYSIS (Uji Sensitivitas Parameter)
// ═══════════════════════════════════════════════════════════════
function SensitivityPanel({ sektor, makro, si, amt, stype, params, setParams }) {
  // Hitung multiplier pada berbagai nilai parameter
  const baseResult = runCGE(sektor, makro, si, amt, stype);
  if (!baseResult) return null;

  const s = baseResult.s;
  const baseTotal = baseResult.total;
  const baseMult  = s.mult;

  // Fungsi hitung total dampak dengan parameter berbeda
  const calcImpact = (sigmaArm, sigmaCet, mpcVal) => {
    const armEffect  = 1 - (sigmaArm - 2.0) * 0.03;   // Armington: lebih tinggi = impor lebih banyak
    const cetEffect  = 1 + (sigmaCet - 2.5) * 0.02;   // CET: lebih tinggi = ekspor lebih responsif
    const mpcEffect  = 1 + (mpcVal - 0.68) * 0.5;     // MPC: lebih tinggi = induced effect lebih besar
    return baseTotal * armEffect * cetEffect * mpcEffect;
  };

  const currentTotal = calcImpact(params.sigmaArm, params.sigmaCet, params.mpc);
  const pctChange    = ((currentTotal - baseTotal) / baseTotal * 100);

  // Range sensitivitas: dari +/-50% base
  const sensitivityData = [0.5,1.0,1.5,2.0,2.5,3.0,3.5,4.0].map(sig => ({
    sig,
    armImpact: calcImpact(sig, params.sigmaCet, params.mpc),
    cetImpact: calcImpact(params.sigmaArm, sig, params.mpc),
  }));

  return (
    <div style={{...card}}>
      <div style={{fontSize:11,color:"#64748b",...mono,marginBottom:14}}>
        UJI SENSITIVITAS PARAMETER (Bab 2.5 — Sugema & Holis, 2015)
      </div>
      <div style={{background:"#0a1628",borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:11,color:"#94a3b8",lineHeight:1.6}}>
        Geser parameter di bawah untuk melihat bagaimana dampak simulasi berubah. 
        Semakin stabil hasilnya terhadap perubahan parameter, semakin robust model ini.
        Referensi: σ_ARM=2.0, σ_CET=2.5, MPC=0.68 (Oktaviani, 2008).
      </div>

      {/* Slider controls */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14,marginBottom:14}}>
        {[
          ["Elastisitas Armington (σ_ARM)", "sigmaArm", 0.5, 5.0, 0.1,
           "Substitusi impor-domestik. Tinggi = konsumen mudah ganti ke impor.","#0ea5e9"],
          ["Elastisitas CET (σ_CET)", "sigmaCet", 0.5, 6.0, 0.1,
           "Transformasi ekspor-domestik. Tinggi = produsen cepat alihkan ke ekspor.","#8b5cf6"],
          ["MPC Rumah Tangga", "mpc", 0.3, 0.95, 0.01,
           "Marginal Propensity to Consume. Tinggi = lebih banyak pendapatan dibelanjakan.","#f59e0b"],
        ].map(([label, key, min, max, step, desc, color])=>(
          <div key={key} style={{background:"#0a1628",borderRadius:8,padding:"10px 12px"}}>
            <div style={{fontSize:10,color:color,...mono,marginBottom:6,fontWeight:700}}>{label}</div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <input type="range" min={min} max={max} step={step}
                value={params[key]}
                onChange={e=>setParams(p=>({...p,[key]:+e.target.value}))}
                style={{flex:1,accentColor:color}}/>
              <span style={{fontSize:13,fontWeight:700,color,width:36,textAlign:"right",...mono}}>
                {params[key].toFixed(key==="mpc"?2:1)}
              </span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#475569"}}>
              <span>{min}</span>
              <span style={{color:"#64748b"}}>default: {key==="sigmaArm"?"2.0":key==="sigmaCet"?"2.5":"0.68"}</span>
              <span>{max}</span>
            </div>
            <div style={{marginTop:6,fontSize:10,color:"#64748b",lineHeight:1.5}}>{desc}</div>
          </div>
        ))}
      </div>

      {/* Dampak perubahan parameter */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
        <div style={{background:"#0a1628",borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
          <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:4}}>DAMPAK BASE</div>
          <div style={{fontSize:16,fontWeight:700,color:"#22c55e",...mono}}>
            Rp {(baseTotal/1000).toFixed(0)} M
          </div>
          <div style={{fontSize:9,color:"#475569"}}>σ=2.0, σ_CET=2.5, MPC=0.68</div>
        </div>
        <div style={{background:"#0a1628",borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
          <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:4}}>DAMPAK SAAT INI</div>
          <div style={{fontSize:16,fontWeight:700,color:Math.abs(pctChange)<5?"#22c55e":Math.abs(pctChange)<15?"#f59e0b":"#ef4444",...mono}}>
            Rp {(currentTotal/1000).toFixed(0)} M
          </div>
          <div style={{fontSize:9,color:"#475569"}}>parameter aktif di atas</div>
        </div>
        <div style={{background:"#0a1628",borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
          <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:4}}>PERUBAHAN</div>
          <div style={{fontSize:16,fontWeight:700,
            color:Math.abs(pctChange)<5?"#22c55e":Math.abs(pctChange)<15?"#f59e0b":"#ef4444",...mono}}>
            {pctChange>=0?"+":""}{pctChange.toFixed(1)}%
          </div>
          <div style={{fontSize:9,color:Math.abs(pctChange)<5?"#22c55e":Math.abs(pctChange)<15?"#f59e0b":"#ef4444"}}>
            {Math.abs(pctChange)<5?"Model stabil ✓":Math.abs(pctChange)<15?"Sensitif sedang":("Sangat sensitif ⚠")}
          </div>
        </div>
      </div>

      {/* Grafik sensitivitas Armington vs CET */}
      <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:8}}>KURVA SENSITIVITAS — Dampak vs Elastisitas</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {[
          ["σ_Armington (0.5→4.0)","armImpact","#0ea5e9"],
          ["σ_CET (0.5→4.0)","cetImpact","#8b5cf6"],
        ].map(([label,key,color])=>{
          const maxV = Math.max(...sensitivityData.map(d=>d[key]));
          const minV = Math.min(...sensitivityData.map(d=>d[key]));
          const range = maxV - minV || 1;
          return (
            <div key={key} style={{background:"#0a1628",borderRadius:8,padding:"10px 12px"}}>
              <div style={{fontSize:10,color:color,...mono,marginBottom:8}}>{label}</div>
              <svg viewBox={`0 0 200 80`} style={{width:"100%",height:80}}>
                {/* Grid */}
                {[0,0.25,0.5,0.75,1].map(v=>(
                  <line key={v} x1={0} y1={v*70+5} x2={200} y2={v*70+5}
                    stroke="#1e293b" strokeWidth={0.5}/>
                ))}
                {/* Line */}
                <polyline
                  points={sensitivityData.map((d,i)=>`${i*(200/7)},${75 - ((d[key]-minV)/range)*65}`).join(" ")}
                  fill="none" stroke={color} strokeWidth={2}/>
                {/* Current param dot */}
                {sensitivityData.map((d,i)=>{
                  const isBase = (key==="armImpact" && Math.abs(d.sig-params.sigmaArm)<0.3)
                                ||(key==="cetImpact" && Math.abs(d.sig-params.sigmaCet)<0.3);
                  if (!isBase) return null;
                  return <circle key={i} cx={i*(200/7)} cy={75 - ((d[key]-minV)/range)*65}
                    r={5} fill={color} stroke="#fff" strokeWidth={1.5}/>;
                })}
                {/* Labels */}
                {["0.5","1.0","1.5","2.0","2.5","3.0","3.5","4.0"].map((v,i)=>(
                  <text key={i} x={i*(200/7)} y={78} textAnchor="middle"
                    fontSize={7} fill="#475569" fontFamily="monospace">{v}</text>
                ))}
              </svg>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#475569",marginTop:4}}>
                <span>Min: Rp {(minV/1000).toFixed(0)}M</span>
                <span>Max: Rp {(maxV/1000).toFixed(0)}M</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FITUR 3 — SKENARIO A vs B (Komparasi Kebijakan)
// ═══════════════════════════════════════════════════════════════
function SkenarioAB({ sektor, makro }) {
  const [scenA, setScenA] = useState({ si:15, amt:500000, stype:"investasi", label:"Skenario A" });
  const [scenB, setScenB] = useState({ si:22, amt:500000, stype:"subsidi",   label:"Skenario B" });
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState(null);

  const runComparison = () => {
    setIsRunning(true);
    setTimeout(()=>{
      const ra = runCGE(sektor, makro, scenA.si, scenA.amt, scenA.stype);
      const rb = runCGE(sektor, makro, scenB.si, scenB.amt, scenB.stype);
      setResult({a:ra, b:rb});
      setIsRunning(false);
    }, 300);
  };

  const inputStyle = {
    width:"100%", background:"#0a1628", border:"1px solid #334155",
    borderRadius:8, color:"#f1f5f9", padding:"7px 10px", fontSize:11,
    boxSizing:"border-box", marginTop:3
  };

  const MetricRow = ({label, valA, valB, color, fmt_fn}) => {
    const a = fmt_fn ? fmt_fn(valA) : valA;
    const b = fmt_fn ? fmt_fn(valB) : valB;
    const winner = valA > valB ? "A" : valB > valA ? "B" : null;
    return (
      <tr style={{borderBottom:"1px solid #1e293b"}}>
        <td style={{padding:"6px 10px",fontSize:11,color:"#94a3b8"}}>{label}</td>
        <td style={{padding:"6px 10px",textAlign:"right",fontSize:11,...mono,
          color: winner==="A"?color:"#e2e8f0", fontWeight: winner==="A"?"700":"400"}}>
          {a}{winner==="A"&&<span style={{marginLeft:4,fontSize:9,color}}> ✓</span>}
        </td>
        <td style={{padding:"6px 10px",textAlign:"right",fontSize:11,...mono,
          color: winner==="B"?color:"#e2e8f0", fontWeight: winner==="B"?"700":"400"}}>
          {b}{winner==="B"&&<span style={{marginLeft:4,fontSize:9,color}}> ✓</span>}
        </td>
      </tr>
    );
  };

  return (
    <div style={{...card}}>
      <div style={{fontSize:11,color:"#64748b",...mono,marginBottom:14}}>
        KOMPARASI SKENARIO KEBIJAKAN A vs B (Sugema & Holis, 2015 — Bab 2.5)
      </div>

      {/* Konfigurasi Skenario */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
        {[
          [scenA, setScenA, "#22c55e", "Skenario A"],
          [scenB, setScenB, "#f97316", "Skenario B"],
        ].map(([scen, setScen, color, title])=>(
          <div key={title} style={{background:"#0a1628",borderRadius:8,padding:"10px 12px",
            borderTop:`3px solid ${color}`}}>
            <div style={{fontSize:12,fontWeight:700,color,marginBottom:10}}>{title}</div>
            <div style={{marginBottom:8}}>
              <label style={{fontSize:10,color:"#64748b",...mono}}>NAMA SKENARIO</label>
              <input type="text" value={scen.label}
                onChange={e=>setScen(p=>({...p,label:e.target.value}))}
                style={inputStyle}/>
            </div>
            <div style={{marginBottom:8}}>
              <label style={{fontSize:10,color:"#64748b",...mono}}>SEKTOR TARGET</label>
              <select value={scen.si} onChange={e=>setScen(p=>({...p,si:+e.target.value}))}
                style={inputStyle}>
                {sektor.map((s,i)=>(
                  <option key={s.id} value={i}>{s.id}. {s.nama.slice(0,28)} (×{s.mult.toFixed(2)})</option>
                ))}
              </select>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div>
                <label style={{fontSize:10,color:"#64748b",...mono}}>SHOCK (JUTA RP)</label>
                <input type="number" value={scen.amt} min={1000} step={50000}
                  onChange={e=>setScen(p=>({...p,amt:+e.target.value}))}
                  style={inputStyle}/>
              </div>
              <div>
                <label style={{fontSize:10,color:"#64748b",...mono}}>JENIS</label>
                <select value={scen.stype} onChange={e=>setScen(p=>({...p,stype:e.target.value}))}
                  style={inputStyle}>
                  {["investasi","subsidi","ekspor","belanja_pemerintah","pajak"].map(t=>(
                    <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1).replace("_"," ")}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tombol Run */}
      <button onClick={runComparison} disabled={isRunning}
        style={{width:"100%",padding:"10px",borderRadius:8,border:"none",
          background: isRunning?"#1e293b":"linear-gradient(90deg,#22c55e,#f97316)",
          color: isRunning?"#64748b":"#0f172a",fontSize:13,fontWeight:700,cursor:isRunning?"wait":"pointer",
          marginBottom:14}}>
        {isRunning?"⏳ Menghitung...":"⚡ Bandingkan Kedua Skenario"}
      </button>

      {/* Hasil Komparasi */}
      {result && result.a && result.b && (
        <div>
          {/* KPI Perbandingan */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
            {[
              ["Multiplier Output","×","mult",r=>r.s.mult.toFixed(3)],
              ["Total Dampak","Jt Rp","total",r=>fmt(Math.round(r.total))],
              ["Dampak PDRB","%","gdp",r=>"+"+r.gdpEff.toFixed(2)+"%"],
              ["Efisiensi/Juta","%","eff",r=>(r.total/r.shock*100).toFixed(0)+"%"],
            ].map(([label,unit,key,fn])=>{
              const vA = key==="mult"?result.a.s.mult:key==="gdp"?result.a.gdpEff:key==="eff"?result.a.total/result.a.shock:result.a.total;
              const vB = key==="mult"?result.b.s.mult:key==="gdp"?result.b.gdpEff:key==="eff"?result.b.total/result.b.shock:result.b.total;
              const winA = vA >= vB;
              return (
                <div key={label} style={{background:"#0a1628",borderRadius:8,padding:"8px 10px",textAlign:"center"}}>
                  <div style={{fontSize:9,color:"#64748b",...mono,marginBottom:4}}>{label}</div>
                  <div style={{display:"flex",justifyContent:"space-around",alignItems:"center",gap:4}}>
                    <div>
                      <div style={{fontSize:11,...mono,fontWeight:winA?700:400,
                        color:winA?"#22c55e":"#94a3b8"}}>{fn(result.a)}</div>
                      <div style={{fontSize:9,color:"#22c55e"}}>A</div>
                    </div>
                    <div style={{color:"#334155",fontSize:11}}>vs</div>
                    <div>
                      <div style={{fontSize:11,...mono,fontWeight:!winA?700:400,
                        color:!winA?"#f97316":"#94a3b8"}}>{fn(result.b)}</div>
                      <div style={{fontSize:9,color:"#f97316"}}>B</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tabel Detail */}
          <div style={{overflow:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead>
                <tr style={{background:"#1e293b"}}>
                  <th style={{padding:"8px 10px",textAlign:"left",color:"#64748b",...mono,fontSize:10,borderBottom:"1px solid #334155"}}>Indikator</th>
                  <th style={{padding:"8px 10px",textAlign:"right",color:"#22c55e",...mono,fontSize:10,borderBottom:"1px solid #334155"}}>
                    {scenA.label} ({scenA.stype})
                  </th>
                  <th style={{padding:"8px 10px",textAlign:"right",color:"#f97316",...mono,fontSize:10,borderBottom:"1px solid #334155"}}>
                    {scenB.label} ({scenB.stype})
                  </th>
                </tr>
              </thead>
              <tbody>
                <MetricRow label="Sektor Target"
                  valA={result.a.s.nama} valB={result.b.s.nama}
                  color="#22c55e"
                  fmt_fn={v=>v}/>
                <MetricRow label="Multiplier Output"
                  valA={result.a.s.mult} valB={result.b.s.mult}
                  color="#22c55e"
                  fmt_fn={v=>v.toFixed(4)+"×"}/>
                <MetricRow label="Total Dampak Output (Juta Rp)"
                  valA={result.a.total} valB={result.b.total}
                  color="#22c55e"
                  fmt_fn={v=>"Rp "+fmt(Math.round(v))}/>
                <MetricRow label="Dampak ke PDRB"
                  valA={result.a.gdpEff} valB={result.b.gdpEff}
                  color="#22c55e"
                  fmt_fn={v=>"+"+v.toFixed(2)+"%"}/>
                <MetricRow label="Efek Pendapatan TK (Juta Rp)"
                  valA={result.a.incomeEff} valB={result.b.incomeEff}
                  color="#22c55e"
                  fmt_fn={v=>"Rp "+fmt(Math.round(v))}/>
                <MetricRow label="Konsumsi RT Induced (Juta Rp)"
                  valA={result.a.consumpEff} valB={result.b.consumpEff}
                  color="#22c55e"
                  fmt_fn={v=>"Rp "+fmt(Math.round(v))}/>
                <MetricRow label="Penerimaan Pajak (Juta Rp)"
                  valA={result.a.govRevEff} valB={result.b.govRevEff}
                  color="#22c55e"
                  fmt_fn={v=>"Rp "+fmt(Math.round(v))}/>
                <MetricRow label="Est. Lapangan Kerja (orang)"
                  valA={result.a.employEff} valB={result.b.employEff}
                  color="#22c55e"
                  fmt_fn={v=>"~"+fmt(v)}/>
                <MetricRow label="BL Sektor Target"
                  valA={result.a.s.bl_n} valB={result.b.s.bl_n}
                  color="#22c55e"
                  fmt_fn={v=>v.toFixed(3)}/>
                <MetricRow label="FL Sektor Target"
                  valA={result.a.s.fl_n} valB={result.b.s.fl_n}
                  color="#22c55e"
                  fmt_fn={v=>v.toFixed(3)}/>
                <MetricRow label="Efisiensi (Output/Shock)"
                  valA={result.a.total/result.a.shock} valB={result.b.total/result.b.shock}
                  color="#22c55e"
                  fmt_fn={v=>v.toFixed(3)+"×"}/>
              </tbody>
            </table>
          </div>

          {/* Rekomendasi otomatis */}
          <div style={{marginTop:12,padding:"10px 14px",
            background: result.a.total >= result.b.total ? "#0f2d1a" : "#1a0d05",
            borderRadius:8,borderLeft:`3px solid ${result.a.total>=result.b.total?"#22c55e":"#f97316"}`,
            fontSize:11,color:"#94a3b8",lineHeight:1.7}}>
            <strong style={{color: result.a.total>=result.b.total?"#22c55e":"#f97316"}}>
              Rekomendasi Otomatis:
            </strong>{" "}
            {result.a.total >= result.b.total
              ? `${scenA.label} (${result.a.s.nama}) lebih efisien — multiplier ${result.a.s.mult.toFixed(3)}× vs ${result.b.s.mult.toFixed(3)}×. Untuk anggaran yang sama, ${scenA.label} menghasilkan Rp ${fmt(Math.round(result.a.total-result.b.total))} Juta output LEBIH BANYAK.`
              : `${scenB.label} (${result.b.s.nama}) lebih efisien — multiplier ${result.b.s.mult.toFixed(3)}× vs ${result.a.s.mult.toFixed(3)}×. Untuk anggaran yang sama, ${scenB.label} menghasilkan Rp ${fmt(Math.round(result.b.total-result.a.total))} Juta output LEBIH BANYAK.`
            }
          </div>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// FITUR 4 — LES (Linear Expenditure System) Stone-Geary
// Sugema & Holis (2015) Bab 5.1.2 — RT Konsumsi Endogen
// ═══════════════════════════════════════════════════════════════
function LESPanel({ cge, makro, si, amt, stype, sektor, setSi, setAmt, setStype }) {
  const [localSi,    setLocalSi]    = useState(si    !== undefined ? si    : 15);
  const [localAmt,   setLocalAmt]   = useState(amt   !== undefined ? amt   : 500000);
  const [localStype, setLocalStype] = useState(stype !== undefined ? stype : "investasi");
  const [synced,     setSynced]     = useState(true);

  // Saat props si/amt/stype berubah (user mengubah di tab Simulasi),
  // update localState agar saat switch ke manual, nilai awalnya = nilai terkini
  useEffect(()=>{ if(si    !== undefined) setLocalSi(si);    }, [si]);
  useEffect(()=>{ if(amt   !== undefined) setLocalAmt(amt);  }, [amt]);
  useEffect(()=>{ if(stype !== undefined) setLocalStype(stype); }, [stype]);

  // Sinkronisasi saat props berubah
  const effSi    = synced && si    !== undefined ? si    : localSi;
  const effAmt   = synced && amt   !== undefined ? amt   : localAmt;
  const effStype = synced && stype !== undefined ? stype : localStype;

  const s = sektor && sektor[effSi];

  // Hitung CGE lokal jika perlu (saat tidak sinkron atau CGE belum dijalankan)
  const localCge = (!synced || !cge) && sektor && makro
    ? runCGE(sektor, makro, effSi, effAmt, effStype)
    : null;
  const activeCge = (synced && cge) ? cge : localCge;

  // Kenaikan pendapatan RT dari hasil CGE
  const incomeChangePct = activeCge
    ? (activeCge.incomeEff / (makro.C_rt || LES_BASE.Y0) * 100)
    : 0;

  // Simulasi LES
  const simulateLES = (dY_pct) => {
    const Y_new   = LES_BASE.Y0 * (1 + dY_pct / 100);
    const sup_new = Y_new - LES_BASE.totalGamma;
    return LES_PARAMS.map(p => {
      const C_new = p.gamma_i + p.beta_i * sup_new;
      const dC    = C_new - p.C_i;
      return {
        nama: p.nama, C_old: p.C_i, C_new: Math.round(C_new),
        dC: Math.round(dC), dC_pct: dC / p.C_i * 100,
        gamma_i: p.gamma_i, beta_i: p.beta_i, eta_i: p.eta_i,
        share_new: C_new / Y_new,
      };
    });
  };

  const lesResult  = simulateLES(incomeChangePct);
  const totalNewC  = lesResult.reduce((a, b) => a + b.C_new, 0);
  const totalDeltaC = totalNewC - LES_BASE.Y0;
  const COLORS = ["#22c55e","#0ea5e9","#f59e0b","#f97316","#8b5cf6","#ec4899","#06b6d4"];
  const inputSty = {background:"#0a1628",border:"1px solid #334155",borderRadius:7,
    color:"#f1f5f9",padding:"7px 10px",fontSize:11,boxSizing:"border-box",width:"100%"};

  return (
    <div>
      {/* ── PANEL KONFIGURASI SIMULASI ── */}
      <div style={{...card,marginBottom:14,borderTop:"2px solid #22c55e"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div style={{fontSize:12,fontWeight:700,color:"#22c55e"}}>
            ⚙️ Konfigurasi Simulasi — Sumber Data LES
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:10,color:synced&&cge?"#22c55e":"#64748b"}}>
              {synced ? "🔗 Ikut tab ⚡ Simulasi & Transmisi" : "✏️ Konfigurasi mandiri"}
            </span>
            <button onClick={()=>setSynced(v=>!v)}
              style={{padding:"4px 12px",borderRadius:6,border:"none",fontSize:10,fontWeight:700,cursor:"pointer",
                background:synced?"#22c55e22":"#334155",color:synced?"#22c55e":"#94a3b8"}}>
              {synced ? "Mode Sinkron" : "Mode Manual"}
            </button>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:10}}>
          {/* Sektor */}
          <div>
            <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:4}}>SEKTOR TARGET</div>
            {synced && cge
              ? <div style={{...inputSty,color:"#22c55e",fontWeight:600}}>
                  {s ? `${s.id}. ${s.nama}` : "-"}
                </div>
              : <select value={localSi} onChange={e=>{setLocalSi(+e.target.value);}}
                  style={inputSty}>
                  {(sektor||[]).map((sk,i)=>(
                    <option key={sk.id} value={i}>{sk.id}. {sk.nama.slice(0,28)}</option>
                  ))}
                </select>
            }
          </div>
          {/* Besar Shock */}
          <div>
            <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:4}}>BESAR SHOCK (JT RP)</div>
            {synced && cge
              ? <div style={{...inputSty,color:"#22c55e",fontWeight:600}}>
                  {fmt(effAmt)}
                </div>
              : <input type="number" value={localAmt} min={1000} step={50000}
                  onChange={e=>setLocalAmt(+e.target.value)} style={inputSty}/>
            }
          </div>
          {/* Jenis Kebijakan */}
          <div>
            <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:4}}>JENIS KEBIJAKAN</div>
            {synced && cge
              ? <div style={{...inputSty,color:"#22c55e",fontWeight:600}}>
                  {effStype.charAt(0).toUpperCase()+effStype.slice(1).replace("_"," ")}
                </div>
              : <select value={localStype} onChange={e=>setLocalStype(e.target.value)}
                  style={inputSty}>
                  {["investasi","subsidi","ekspor","belanja_pemerintah","pajak"].map(t=>(
                    <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1).replace("_"," ")}</option>
                  ))}
                </select>
            }
          </div>
        </div>

        {/* Info hasil CGE yang digunakan */}
        {/* Info box penjelasan mode sinkron */}
        {synced && (
          <div style={{marginTop:10,padding:"8px 12px",
            background:"#0f2d1a",borderRadius:6,
            border:"1px solid #22c55e44",fontSize:11,color:"#94a3b8",lineHeight:1.6}}>
            <strong style={{color:"#22c55e"}}>ℹ️ Mode Sinkron:</strong>{" "}
            Output LES menggunakan hasil dari tab{" "}
            <strong style={{color:"#22c55e"}}>⚡ Simulasi & Transmisi</strong>.
            Untuk menggunakan sektor/shock yang berbeda (misalnya dari tab ⚖️ Komparasi),
            klik tombol <strong style={{color:"#f59e0b"}}>Mode Manual</strong> di atas
            lalu pilih sektor dan shock yang diinginkan.
          </div>
        )}

        {activeCge && (
          <div style={{marginTop:10,display:"flex",gap:16,flexWrap:"wrap",
            background:"#0a1628",borderRadius:8,padding:"8px 12px"}}>
            <div>
              <div style={{fontSize:9,color:"#475569",...mono}}>Sektor (Simulasi Utama)</div>
              <div style={{fontSize:12,fontWeight:700,color:"#22c55e"}}>
                {s ? s.nama : "-"}
              </div>
            </div>
            <div>
              <div style={{fontSize:9,color:"#475569",...mono}}>Shock</div>
              <div style={{fontSize:12,fontWeight:700,color:"#22c55e",...mono}}>
                Rp {fmt(effAmt)} Jt
              </div>
            </div>
            <div>
              <div style={{fontSize:9,color:"#475569",...mono}}>Jenis</div>
              <div style={{fontSize:12,fontWeight:700,color:"#22c55e"}}>
                {effStype.replace("_"," ")}
              </div>
            </div>
            {[
              ["Multiplier", activeCge.effectiveMult?.toFixed(3)+"×", "#ec4899"],
              ["Δ Pdpt TK",  "Rp "+fmt(Math.round(activeCge.incomeEff))+" Jt","#f59e0b"],
              ["Δ Pdpt RT %",(incomeChangePct>=0?"+":"")+incomeChangePct.toFixed(3)+"%","#0ea5e9"],
            ].map(([l,v,c])=>(
              <div key={l}>
                <div style={{fontSize:9,color:"#475569",...mono}}>{l}</div>
                <div style={{fontSize:12,fontWeight:700,color:c,...mono}}>{v}</div>
              </div>
            ))}
          </div>
        )}

        {!activeCge && synced && (
          <div style={{marginTop:10,padding:"8px 12px",background:"#1a0505",borderRadius:6,
            fontSize:11,color:"#ef4444"}}>
            ⚠️ Simulasi belum dijalankan. Buka tab{" "}
            <strong>⚡ Simulasi & Transmisi</strong>, pilih sektor dan shock, jalankan dulu.
          </div>
        )}
      </div>

      {/* Info LES */}
      <div style={{...card,marginBottom:14}}>
        <div style={{fontSize:11,color:"#64748b",...mono,marginBottom:10}}>
          FUNGSI KONSUMSI LES / STONE-GEARY — Rembang 2016 (Sugema & Holis, 2015 — Bab 5.1.2)
        </div>
        <div style={{background:"#0a1628",borderRadius:8,padding:"10px 14px",
          marginBottom:14,fontSize:11,color:"#94a3b8",lineHeight:1.7}}>
          <strong style={{color:"#f1f5f9"}}>Apa itu LES?</strong>{" "}
          Model konsumsi yang lebih realistis dari MPC konstan. Setiap komoditas punya{" "}
          <strong style={{color:"#22c55e"}}>konsumsi minimum γ (subsisten)</strong> yang dipenuhi dulu.
          Sisa pendapatan setelah subsisten (<em>supernumerary income</em>) baru dibagi sesuai{" "}
          <strong style={{color:"#0ea5e9"}}>marginal budget share β</strong>.{" "}
          {activeCge
            ? <span style={{color:"#f59e0b"}}>
                Shock <strong>{effStype}</strong> Rp {fmt(effAmt)} Jt ke sektor <strong>{s?.nama}</strong>{" "}
                → pendapatan RT naik{" "}
                <strong>{(incomeChangePct>=0?"+":"")+incomeChangePct.toFixed(3)}%</strong>{" "}
                → LES menghitung distribusi kenaikan konsumsi per komoditas.
              </span>
            : <span style={{color:"#ef4444"}}>
                Jalankan simulasi di tab ⚡ Simulasi & Transmisi, atau aktifkan Atur Manual di atas.
              </span>
          }
        </div>

        {/* KPI */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
          {[
            ["Δ Pendapatan RT", `${incomeChangePct>=0?"+":""}${incomeChangePct.toFixed(3)}%`, "#f59e0b"],
            ["Δ Konsumsi Total",`${totalDeltaC>=0?"+":""}Rp ${fmt(Math.round(totalDeltaC))} Jt`,"#22c55e"],
            ["MPC Efektif LES", incomeChangePct!==0
              ? (totalDeltaC/(LES_BASE.Y0*incomeChangePct/100)).toFixed(4)
              : "—", "#0ea5e9"],
            ["Supernumerary",   `Rp ${fmt(Math.round(LES_BASE.supernumerary*(1+incomeChangePct/100)))} Jt`,"#8b5cf6"],
          ].map(([l,v,c])=>(
            <div key={l} style={{background:"#0a1628",borderRadius:8,padding:"8px 10px",textAlign:"center"}}>
              <div style={{fontSize:9,color:"#64748b",...mono,marginBottom:3}}>{l}</div>
              <div style={{fontSize:12,fontWeight:700,color:c,...mono}}>{v}</div>
            </div>
          ))}
        </div>

        {/* Tabel LES */}
        <div style={{overflow:"auto",marginBottom:12}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead><tr style={{background:"#1e293b"}}>
              {["Komoditas","γ Subsisten","β MBS","η Elast.",
                "C Base (Jt Rp)","C Baru (Jt Rp)","ΔC (Jt Rp)","%Δ"].map(h=>(
                <th key={h} style={{padding:"7px 9px",textAlign:h==="Komoditas"?"left":"right",
                  color:"#64748b",...mono,fontSize:9,borderBottom:"1px solid #334155",whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {lesResult.map((r,i)=>(
                <tr key={i} style={{borderBottom:"1px solid #0f172a",
                  background:i%2===0?"#0f172a":"#0a1628"}}>
                  <td style={{padding:"6px 9px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:7}}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:COLORS[i],flexShrink:0}}/>
                      <span style={{fontSize:11,color:"#e2e8f0"}}>{r.nama}</span>
                    </div>
                  </td>
                  <td style={{padding:"6px 9px",textAlign:"right",fontSize:10,...mono,color:"#64748b"}}>
                    {(r.gamma_i/r.C_old*100).toFixed(0)}%
                  </td>
                  <td style={{padding:"6px 9px",textAlign:"right",fontSize:10,...mono,color:"#0ea5e9"}}>
                    {r.beta_i.toFixed(4)}
                  </td>
                  <td style={{padding:"6px 9px",textAlign:"right",fontSize:10,...mono}}>
                    <span style={{color:r.eta_i>1?"#f59e0b":"#94a3b8"}}>{r.eta_i.toFixed(2)}</span>
                    <span style={{fontSize:8,color:"#475569",marginLeft:4}}>
                      {r.eta_i>1?"mewah":"kebutuhn"}
                    </span>
                  </td>
                  <td style={{padding:"6px 9px",textAlign:"right",fontSize:10,...mono,color:"#94a3b8"}}>
                    {fmt(r.C_old)}
                  </td>
                  <td style={{padding:"6px 9px",textAlign:"right",fontSize:10,...mono,color:"#f8fafc"}}>
                    {fmt(r.C_new)}
                  </td>
                  <td style={{padding:"6px 9px",textAlign:"right",fontSize:10,...mono,
                    color:r.dC>=0?"#22c55e":"#ef4444",fontWeight:700}}>
                    {r.dC>=0?"+":""}{fmt(r.dC)}
                  </td>
                  <td style={{padding:"6px 9px",textAlign:"right",fontSize:10,...mono}}>
                    <div style={{display:"flex",alignItems:"center",gap:5,justifyContent:"flex-end"}}>
                      <div style={{width:36,height:5,background:"#1e293b",borderRadius:3}}>
                        <div style={{width:`${Math.min(100,Math.abs(r.dC_pct)/15*100)}%`,
                          height:"100%",background:r.dC_pct>=0?"#22c55e":"#ef4444",borderRadius:3}}/>
                      </div>
                      <span style={{color:r.dC_pct>=0?"#22c55e":"#ef4444"}}>
                        {r.dC_pct>=0?"+":""}{r.dC_pct.toFixed(2)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Interpretasi */}
        <div style={{background:"#0a1628",borderRadius:8,padding:"10px 14px",
          fontSize:11,color:"#94a3b8",lineHeight:1.7}}>
          <strong style={{color:"#f1f5f9"}}>Interpretasi LES:</strong>{" "}
          {incomeChangePct!==0
            ? <>Pendapatan RT {incomeChangePct>=0?"naik":"turun"}{" "}
                <strong style={{color:incomeChangePct>=0?"#22c55e":"#ef4444"}}>
                  {incomeChangePct>=0?"+":""}{incomeChangePct.toFixed(3)}%
                </strong>{" "}
                akibat shock <strong>{effStype}</strong> Rp {fmt(effAmt)} Jt di sektor{" "}
                <strong>{s?.nama}</strong>.{" "}
                Semua komoditas {incomeChangePct>0?"naik":"turun"} mengikuti arah pendapatan.
                Komoditas dengan <strong style={{color:"#f59e0b"}}>η&gt;1</strong> tumbuh{" "}
                <em>lebih cepat</em> dari rata-rata ({incomeChangePct>=0?"+":""}{incomeChangePct.toFixed(3)}%):{" "}
                {lesResult.filter(r=>r.eta_i>1).map(r=>
                  r.nama.split(" ")[0]+"("+( r.dC_pct>=0?"+":"")+r.dC_pct.toFixed(2)+"%)"
                ).join(", ")}.
                Komoditas dengan <strong style={{color:"#94a3b8"}}>η&lt;1</strong> tumbuh{" "}
                <em>lebih lambat</em>:{" "}
                {lesResult.filter(r=>r.eta_i<1).map(r=>
                  r.nama.split(" ")[0]+"("+( r.dC_pct>=0?"+":"")+r.dC_pct.toFixed(2)+"%)"
                ).join(", ")}.
                MPC efektif LES = <strong style={{color:"#0ea5e9"}}>
                  {incomeChangePct!==0?(totalDeltaC/(LES_BASE.Y0*incomeChangePct/100)).toFixed(4):"—"}
                </strong>{" "}
                (bisa berbeda dari MPC konstan 0.68 karena struktur subsisten tiap komoditas berbeda).
              </>
            : "Jalankan simulasi untuk melihat bagaimana shock kebijakan mengubah pola konsumsi RT via model LES."
          }
        </div>
      </div>
    </div>
  );
}

function IHPIHKPanel({ cge, sektor, makro, si, amt, stype, setSi, setAmt, setStype }) {
  const [localSi,    setLocalSi]    = useState(si    !== undefined ? si    : 15);
  const [localAmt,   setLocalAmt]   = useState(amt   !== undefined ? amt   : 500000);
  const [localStype, setLocalStype] = useState(stype !== undefined ? stype : "investasi");
  const [synced,     setSynced]     = useState(true);

  // Sync saat props berubah dari tab Simulasi
  useEffect(()=>{ if(si    !== undefined) setLocalSi(si);    }, [si]);
  useEffect(()=>{ if(amt   !== undefined) setLocalAmt(amt);  }, [amt]);
  useEffect(()=>{ if(stype !== undefined) setLocalStype(stype); }, [stype]);

  const effSi    = synced && si    !== undefined ? si    : localSi;
  const effAmt   = synced && amt   !== undefined ? amt   : localAmt;
  const effStype = synced && stype !== undefined ? stype : localStype;
  const s        = sektor && sektor[effSi];

  const localCge = (!synced || !cge) && sektor && makro
    ? runCGE(sektor, makro, effSi, effAmt, effStype)
    : null;
  const activeCge = (synced && cge) ? cge : localCge;

  const eps_supply = 0.30;
  const eps_demand = 0.20;

  // Hitung perubahan output per kelompok dari CGE
  const getOutputChange = () => {
    if (!activeCge) return {};
    const grpChange = {};
    (activeCge.sectorImpact||[]).forEach(imp=>{
      if (!grpChange[imp.grp]) grpChange[imp.grp] = {total:0,count:0};
      grpChange[imp.grp].total += imp.dampak;
      grpChange[imp.grp].count += 1;
    });
    const result = {};
    Object.entries(grpChange).forEach(([grp,g])=>{
      const baseOut = (sektor||[]).filter(sk=>sk.grp===grp).reduce((a,b)=>a+b.output,0);
      result[grp] = baseOut>0 ? (g.total/baseOut*100) : 0;
    });
    return result;
  };

  const outputChange = getOutputChange();

  const ihpData = Object.entries(IHP_WEIGHTS_MAP).map(([grp,weight])=>{
    const dOutput   = outputChange[grp] || 0;
    const supplyEff = -dOutput * eps_supply;
    const demandEff = activeCge ? activeCge.gdpEff * eps_demand : 0;
    const dPrice    = supplyEff + demandEff;
    return {grp, weight, dOutput, dPrice, contrib: weight*dPrice};
  });
  const deltaIHP = ihpData.reduce((a,b)=>a+b.contrib,0);

  const ihkData = IHK_WEIGHTS.map(komp=>{
    const relSec = (sektor||[]).filter(sk=>komp.sektor.includes(sk.grp));
    const avgOut = relSec.length>0
      ? relSec.reduce((a,sk)=>a+(outputChange[sk.grp]||0),0)/relSec.length
      : (activeCge ? activeCge.gdpEff : 0);
    const supEff = -avgOut * eps_supply;
    const demEff = activeCge ? activeCge.gdpEff * eps_demand : 0;
    const dPrice = supEff + demEff;
    return {nama:komp.nama, w:komp.w, dOutput:avgOut, dPrice, contrib:komp.w*dPrice};
  });
  const deltaIHK = ihkData.reduce((a,b)=>a+b.contrib,0);

  const realIncomeEff   = activeCge ? activeCge.gdpEff - deltaIHK : 0;
  const inflasiColor    = Math.abs(deltaIHK)<0.5?"#22c55e":Math.abs(deltaIHK)<1.5?"#f59e0b":Math.abs(deltaIHK)<3?"#f97316":"#ef4444";
  const inflasiLabel    = Math.abs(deltaIHK)<0.5?"Sangat Rendah":Math.abs(deltaIHK)<1.5?"Rendah":Math.abs(deltaIHK)<3?"Sedang":"Tinggi";

  const inputSty = {background:"#0a1628",border:"1px solid #334155",borderRadius:7,
    color:"#f1f5f9",padding:"7px 10px",fontSize:11,width:"100%",boxSizing:"border-box"};

  return (
    <div>
      {/* ── PANEL KONFIGURASI ── */}
      <div style={{...card,marginBottom:14,borderTop:"2px solid #f97316"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div style={{fontSize:12,fontWeight:700,color:"#f97316"}}>
            ⚙️ Konfigurasi Simulasi — Sumber Data IHP & IHK
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:10,color:"#64748b"}}>
              {synced&&cge?"🔗 Sinkron dengan tab Simulasi":"✏️ Konfigurasi mandiri"}
            </span>
            <button onClick={()=>setSynced(v=>!v)}
              style={{padding:"4px 12px",borderRadius:6,border:"none",fontSize:10,fontWeight:700,cursor:"pointer",
                background:synced?"#f9731622":"#334155",color:synced?"#f97316":"#94a3b8"}}>
              {synced?"Pakai Hasil Simulasi":"Atur Manual"}
            </button>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:10}}>
          <div>
            <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:4}}>SEKTOR TARGET</div>
            {synced&&cge
              ? <div style={{...inputSty,color:"#f97316",fontWeight:600}}>
                  {s?`${s.id}. ${s.nama}`:"-"}
                </div>
              : <select value={localSi} onChange={e=>setLocalSi(+e.target.value)} style={inputSty}>
                  {(sektor||[]).map((sk,i)=>(
                    <option key={sk.id} value={i}>{sk.id}. {sk.nama.slice(0,28)}</option>
                  ))}
                </select>
            }
          </div>
          <div>
            <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:4}}>BESAR SHOCK (JT RP)</div>
            {synced&&cge
              ? <div style={{...inputSty,color:"#f97316",fontWeight:600}}>{fmt(effAmt)}</div>
              : <input type="number" value={localAmt} min={1000} step={50000}
                  onChange={e=>setLocalAmt(+e.target.value)} style={inputSty}/>
            }
          </div>
          <div>
            <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:4}}>JENIS KEBIJAKAN</div>
            {synced&&cge
              ? <div style={{...inputSty,color:"#f97316",fontWeight:600}}>
                  {effStype.charAt(0).toUpperCase()+effStype.slice(1).replace("_"," ")}
                </div>
              : <select value={localStype} onChange={e=>setLocalStype(e.target.value)} style={inputSty}>
                  {["investasi","subsidi","ekspor","belanja_pemerintah","pajak"].map(t=>(
                    <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1).replace("_"," ")}</option>
                  ))}
                </select>
            }
          </div>
        </div>

        {/* Info box penjelasan mode sinkron */}
        {synced && (
          <div style={{marginTop:10,padding:"8px 12px",
            background:"#1a0d05",borderRadius:6,
            border:"1px solid #f9731644",fontSize:11,color:"#94a3b8",lineHeight:1.6}}>
            <strong style={{color:"#f97316"}}>ℹ️ Mode Sinkron:</strong>{" "}
            IHP & IHK dihitung dari hasil tab{" "}
            <strong style={{color:"#f97316"}}>⚡ Simulasi & Transmisi</strong>.
            Untuk menggunakan sektor/shock berbeda (misal dari tab ⚖️ Komparasi),
            klik <strong style={{color:"#f59e0b"}}>Mode Manual</strong> lalu atur sendiri.
          </div>
        )}

        {activeCge&&(
          <div style={{marginTop:10,display:"flex",gap:16,flexWrap:"wrap",
            background:"#0a1628",borderRadius:8,padding:"8px 12px"}}>
            <div>
              <div style={{fontSize:9,color:"#475569",...mono}}>Sektor (Simulasi Utama)</div>
              <div style={{fontSize:12,fontWeight:700,color:"#f97316"}}>
                {s ? s.nama.slice(0,20) : "-"}
              </div>
            </div>
            <div>
              <div style={{fontSize:9,color:"#475569",...mono}}>Shock</div>
              <div style={{fontSize:12,fontWeight:700,color:"#f97316",...mono}}>
                Rp {fmt(effAmt)} Jt
              </div>
            </div>
            {[
              ["Jenis",   effStype.replace("_"," "),                         "#f97316"],
              ["Δ PDRB",  (activeCge.gdpEff>=0?"+":"")+activeCge.gdpEff.toFixed(3)+"%","#0ea5e9"],
              ["Total",   "Rp "+fmt(Math.round(activeCge.total))+" Jt",     "#22c55e"],
            ].map(([l,v,c])=>(
              <div key={l}>
                <div style={{fontSize:9,color:"#475569",...mono}}>{l}</div>
                <div style={{fontSize:12,fontWeight:700,color:c,...mono}}>{v}</div>
              </div>
            ))}
          </div>
        )}
        {!activeCge&&(
          <div style={{marginTop:10,padding:"8px 12px",background:"#1a0505",borderRadius:6,
            fontSize:11,color:"#ef4444"}}>
            ⚠️ Jalankan simulasi di tab <strong>⚡ Simulasi &amp; Transmisi</strong> dulu,
            atau aktifkan <strong>Mode Manual</strong> di atas.
          </div>
        )}
      </div>

      {/* ── METODOLOGI ── */}
      <div style={{...card,marginBottom:14}}>
        <div style={{fontSize:11,color:"#64748b",...mono,marginBottom:10}}>
          IHP & IHK ENDOGEN (Sugema & Holis, 2015 — Persamaan 5.51 & 5.54)
        </div>
        <div style={{background:"#0a1628",borderRadius:8,padding:"10px 14px",
          marginBottom:14,fontSize:11,color:"#94a3b8",lineHeight:1.7}}>
          <strong style={{color:"#f1f5f9"}}>Metodologi:</strong>{" "}
          ΔP_j = −ε_s × ΔQ_j + ε_d × ΔGDP, di mana
          <strong style={{color:"#0ea5e9"}}> ε_s=0.30</strong> (invers elastisitas penawaran) dan
          <strong style={{color:"#f97316"}}> ε_d=0.20</strong> (elastisitas inflasi permintaan).
          {" "}IHP = Σ(w_j × ΔP_j) untuk sektor produsen.
          {" "}IHK = Σ(w_i × ΔP_i) untuk kelompok komoditas konsumen.
          {activeCge&&<span style={{color:"#f59e0b"}}>
            {" "}Simulasi <strong>{effStype}</strong> Rp {fmt(effAmt)} Jt → ΔGDP = {activeCge.gdpEff.toFixed(3)}%.
          </span>}
        </div>

        {/* 4 KPI */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
          {[
            ["Δ IHP (Produsen)", deltaIHP, deltaIHP<=0?"#22c55e":"#ef4444",
             deltaIHP<0?"Deflasi supply":"Inflasi biaya"],
            ["Δ IHK (Konsumen)", deltaIHK, inflasiColor, inflasiLabel],
            ["Pendapatan Riil RT", realIncomeEff,
             realIncomeEff>=0?"#22c55e":"#ef4444", "ΔY − ΔIHK"],
            ["Spread IHP−IHK", deltaIHP-deltaIHK, "#8b5cf6",
             deltaIHP>deltaIHK?"Produsen lebih terkena":"Konsumen lebih terkena"],
          ].map(([l,v,c,sub])=>(
            <div key={l} style={{background:"#0a1628",borderRadius:8,padding:"10px 12px",
              textAlign:"center",borderTop:`2px solid ${c}`}}>
              <div style={{fontSize:9,color:"#64748b",...mono,marginBottom:4}}>{l}</div>
              <div style={{fontSize:18,fontWeight:800,color:c,...mono}}>
                {typeof v==="number"?(v>=0?"+":"")+v.toFixed(3)+"%" : v}
              </div>
              <div style={{fontSize:9,color:"#475569",marginTop:2}}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Tabel IHP dan IHK berdampingan */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:8}}>IHP — PER SEKTOR PRODUSEN</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{background:"#1e293b"}}>
                {["Kelompok","Bobot","ΔOutput","ΔHarga","Kontrib."].map(h=>(
                  <th key={h} style={{padding:"6px 8px",textAlign:h==="Kelompok"?"left":"right",
                    color:"#64748b",...mono,fontSize:9,borderBottom:"1px solid #334155"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {ihpData.map((d,i)=>(
                  <tr key={i} style={{borderBottom:"1px solid #0f172a",
                    background:i%2===0?"#0f172a":"#0a1628"}}>
                    <td style={{padding:"5px 8px",color:"#e2e8f0",fontSize:10}}>{d.grp}</td>
                    <td style={{padding:"5px 8px",textAlign:"right",...mono,fontSize:10,color:"#64748b"}}>
                      {(d.weight*100).toFixed(0)}%</td>
                    <td style={{padding:"5px 8px",textAlign:"right",...mono,fontSize:10,
                      color:d.dOutput>=0?"#22c55e":"#ef4444"}}>
                      {d.dOutput>=0?"+":""}{d.dOutput.toFixed(2)}%</td>
                    <td style={{padding:"5px 8px",textAlign:"right",...mono,fontSize:10,
                      color:d.dPrice<=0?"#22c55e":"#f97316"}}>
                      {d.dPrice>=0?"+":""}{d.dPrice.toFixed(3)}%</td>
                    <td style={{padding:"5px 8px",textAlign:"right",...mono,fontSize:10,
                      color:d.contrib<=0?"#22c55e":"#f97316",fontWeight:700}}>
                      {d.contrib>=0?"+":""}{d.contrib.toFixed(3)}%</td>
                  </tr>
                ))}
                <tr style={{background:"#0a1628",borderTop:"2px solid #334155"}}>
                  <td colSpan={4} style={{padding:"5px 8px",fontWeight:700,color:"#f8fafc",fontSize:10}}>
                    Δ IHP Total</td>
                  <td style={{padding:"5px 8px",textAlign:"right",fontWeight:800,fontSize:11,...mono,
                    color:deltaIHP<=0?"#22c55e":"#ef4444"}}>
                    {deltaIHP>=0?"+":""}{deltaIHP.toFixed(3)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:8}}>IHK — PER KOMODITAS KONSUMEN</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{background:"#1e293b"}}>
                {["Komoditas","Bobot","ΔHarga","Kontrib."].map(h=>(
                  <th key={h} style={{padding:"6px 8px",textAlign:h==="Komoditas"?"left":"right",
                    color:"#64748b",...mono,fontSize:9,borderBottom:"1px solid #334155"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {ihkData.map((d,i)=>(
                  <tr key={i} style={{borderBottom:"1px solid #0f172a",
                    background:i%2===0?"#0f172a":"#0a1628"}}>
                    <td style={{padding:"5px 8px",color:"#e2e8f0",fontSize:10}}>{d.nama}</td>
                    <td style={{padding:"5px 8px",textAlign:"right",...mono,fontSize:10,color:"#64748b"}}>
                      {(d.w*100).toFixed(1)}%</td>
                    <td style={{padding:"5px 8px",textAlign:"right",...mono,fontSize:10,
                      color:d.dPrice<=0?"#22c55e":"#f97316"}}>
                      {d.dPrice>=0?"+":""}{d.dPrice.toFixed(3)}%</td>
                    <td style={{padding:"5px 8px",textAlign:"right",...mono,fontSize:10,
                      color:d.contrib<=0?"#22c55e":"#f97316",fontWeight:700}}>
                      {d.contrib>=0?"+":""}{d.contrib.toFixed(3)}%</td>
                  </tr>
                ))}
                <tr style={{background:"#0a1628",borderTop:"2px solid #334155"}}>
                  <td colSpan={3} style={{padding:"5px 8px",fontWeight:700,color:"#f8fafc",fontSize:10}}>
                    Δ IHK Total</td>
                  <td style={{padding:"5px 8px",textAlign:"right",fontWeight:800,fontSize:11,...mono,
                    color:deltaIHK<=0?"#22c55e":"#ef4444"}}>
                    {deltaIHK>=0?"+":""}{deltaIHK.toFixed(3)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Interpretasi */}
        <div style={{marginTop:12,background:"#0a1628",borderRadius:8,padding:"10px 14px",
          fontSize:11,color:"#94a3b8",lineHeight:1.7}}>
          <strong style={{color:"#f1f5f9"}}>Interpretasi:</strong>{" "}
          {activeCge
            ? <>Shock <strong>{effStype}</strong> Rp {fmt(effAmt)} Jt ke sektor <strong>{s?.nama}</strong>{" "}
                → ΔGDP {activeCge.gdpEff>=0?"+":""}{activeCge.gdpEff.toFixed(3)}%.
                {" "}IHP {deltaIHP>=0?"naik":"turun"} <strong style={{color:deltaIHP<=0?"#22c55e":"#ef4444"}}>
                  {deltaIHP>=0?"+":""}{deltaIHP.toFixed(3)}%
                </strong> (efek supply mendominasi efek demand).
                {" "}IHK <strong style={{color:inflasiColor}}>{deltaIHK>=0?"+":""}{deltaIHK.toFixed(3)}%</strong>{" "}
                — kategori <strong style={{color:inflasiColor}}>{inflasiLabel}</strong>.
                {" "}Pendapatan riil RT <strong style={{color:realIncomeEff>=0?"#22c55e":"#ef4444"}}>
                  {realIncomeEff>=0?"+":""}{realIncomeEff.toFixed(3)}%
                </strong>{" "}
                ({realIncomeEff>=0?"meningkat — daya beli RT membaik":"menurun — daya beli RT tergerus inflasi"}).
                <em style={{fontSize:10,color:"#475569",display:"block",marginTop:4}}>
                  Catatan: estimasi menggunakan ε_s=0.30, ε_d=0.20. Kalibrasi lokal akan meningkatkan akurasi.
                </em>
              </>
            : "Jalankan simulasi CGE untuk melihat estimasi dampak kebijakan terhadap IHP dan IHK."
          }
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// GRAFIK KUADRAN KETERKAITAN INTERAKTIF
// ─────────────────────────────────────────────
function KuadranChart({ sektor }) {
  const [hovered, setHovered]   = useState(null);
  const [selected, setSelected] = useState(null);
  const [filterGrp, setFilterGrp] = useState("Semua");

  const W = 560, H = 460, PAD = 52;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;

  const filtered = filterGrp === "Semua" ? sektor : sektor.filter(s => s.grp === filterGrp);

  // Skala: BL_norm 0–3.5, FL_norm 0–4.5
  const maxBL = Math.max(3.5, ...sektor.map(s => s.bl_n)) * 1.05;
  const maxFL = Math.max(4.5, ...sektor.map(s => s.fl_n)) * 1.05;

  const toX = bl => PAD + (bl / maxBL) * plotW;
  const toY = fl => PAD + plotH - (fl / maxFL) * plotH;

  // Garis referensi BL=1 dan FL=1
  const refX = toX(1);
  const refY = toY(1);

  // Warna kuadran
  const quadColor = (bl, fl) => {
    if (bl > 1 && fl > 1) return "#22c55e";   // I Kunci
    if (bl <= 1 && fl > 1) return "#0ea5e9";  // II Pemimpin
    if (bl > 1 && fl <= 1) return "#f59e0b";  // III Pengikut
    return "#64748b";                           // IV Independen
  };
  const quadLabel = (bl, fl) => {
    if (bl > 1 && fl > 1) return "I — Kunci";
    if (bl <= 1 && fl > 1) return "II — Pemimpin";
    if (bl > 1 && fl <= 1) return "III — Pengikut";
    return "IV — Independen";
  };

  const grps = ["Semua", ...Object.keys(GRP)];

  // Hitung jumlah sektor per kuadran
  const counts = {
    kunci:    sektor.filter(s => s.bl_n > 1 && s.fl_n > 1).length,
    pemimpin: sektor.filter(s => s.bl_n <= 1 && s.fl_n > 1).length,
    pengikut: sektor.filter(s => s.bl_n > 1 && s.fl_n <= 1).length,
    indepen:  sektor.filter(s => s.bl_n <= 1 && s.fl_n <= 1).length,
  };

  const active = hovered || selected;

  return (
    <div>
      {/* Filter kelompok */}
      <div style={{display:"flex",gap:7,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:11,color:"#64748b",...mono}}>Filter:</span>
        {grps.map(g=>(
          <Chip key={g} active={filterGrp===g} onClick={()=>setFilterGrp(g)} color={GRP[g]||"#22c55e"}>{g}</Chip>
        ))}
        {selected && (
          <button onClick={()=>setSelected(null)}
            style={{marginLeft:"auto",padding:"4px 12px",borderRadius:6,border:"1px solid #334155",background:"transparent",color:"#94a3b8",fontSize:11,cursor:"pointer"}}>
            ✕ Reset pilihan
          </button>
        )}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 340px",gap:14}}>
        {/* SVG Plot */}
        <div style={{...card,padding:10,overflow:"hidden"}}>
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
            {/* Background kuadran */}
            <rect x={refX} y={PAD}     width={PAD+plotW-refX} height={refY-PAD}       fill="#22c55e08"/>
            <rect x={PAD}  y={PAD}     width={refX-PAD}       height={refY-PAD}       fill="#0ea5e908"/>
            <rect x={refX} y={refY}    width={PAD+plotW-refX} height={PAD+plotH-refY} fill="#f59e0b08"/>
            <rect x={PAD}  y={refY}    width={refX-PAD}       height={PAD+plotH-refY} fill="#47456808"/>

            {/* Label kuadran */}
            {[
              [refX+(PAD+plotW-refX)/2, PAD+12,    "I — Sektor KUNCI",      "#22c55e"],
              [PAD+(refX-PAD)/2,        PAD+12,    "II — PEMIMPIN",         "#0ea5e9"],
              [refX+(PAD+plotW-refX)/2, PAD+plotH-8,"III — PENGIKUT",       "#f59e0b"],
              [PAD+(refX-PAD)/2,        PAD+plotH-8,"IV — INDEPENDEN",      "#64748b"],
            ].map(([x,y,lbl,c])=>(
              <text key={lbl} x={x} y={y} textAnchor="middle" fontSize={9}
                fill={c} fontWeight="700" fontFamily="Arial" opacity={0.7}>{lbl}</text>
            ))}

            {/* Grid lines */}
            {[0.5,1.5,2.0,2.5,3.0].map(v=>(
              <line key={"gbl"+v} x1={toX(v)} y1={PAD} x2={toX(v)} y2={PAD+plotH}
                stroke="#1e293b" strokeWidth={0.5} strokeDasharray="2,4"/>
            ))}
            {[0.5,1.5,2.0,2.5,3.0,3.5,4.0].map(v=>(
              <line key={"gfl"+v} x1={PAD} y1={toY(v)} x2={PAD+plotW} y2={toY(v)}
                stroke="#1e293b" strokeWidth={0.5} strokeDasharray="2,4"/>
            ))}

            {/* Referensi garis BL=1 dan FL=1 */}
            <line x1={refX} y1={PAD} x2={refX} y2={PAD+plotH}
              stroke="#334155" strokeWidth={1.5} strokeDasharray="6,3"/>
            <line x1={PAD} y1={refY} x2={PAD+plotW} y2={refY}
              stroke="#334155" strokeWidth={1.5} strokeDasharray="6,3"/>

            {/* Axis ticks dan labels — X (BL) */}
            {[0,0.5,1,1.5,2,2.5,3].map(v=>(
              <g key={"tx"+v}>
                <line x1={toX(v)} y1={PAD+plotH} x2={toX(v)} y2={PAD+plotH+4} stroke="#475569"/>
                <text x={toX(v)} y={PAD+plotH+14} textAnchor="middle"
                  fontSize={8} fill="#64748b" fontFamily="monospace">{v}</text>
              </g>
            ))}
            {/* Axis ticks dan labels — Y (FL) */}
            {[0,0.5,1,1.5,2,2.5,3,3.5,4].map(v=>(
              <g key={"ty"+v}>
                <line x1={PAD-4} y1={toY(v)} x2={PAD} y2={toY(v)} stroke="#475569"/>
                <text x={PAD-8} y={toY(v)+3} textAnchor="end"
                  fontSize={8} fill="#64748b" fontFamily="monospace">{v}</text>
              </g>
            ))}

            {/* Axis labels */}
            <text x={PAD+plotW/2} y={H-6} textAnchor="middle"
              fontSize={10} fill="#94a3b8" fontFamily="Arial">
              Backward Linkage (BL norm) →
            </text>
            <text x={14} y={PAD+plotH/2} textAnchor="middle"
              fontSize={10} fill="#94a3b8" fontFamily="Arial"
              transform={`rotate(-90,14,${PAD+plotH/2})`}>
              ← Forward Linkage (FL norm)
            </text>

            {/* Titik-titik sektor */}
            {filtered.map((s, idx) => {
              const cx = toX(s.bl_n);
              const cy = toY(s.fl_n);
              const col = quadColor(s.bl_n, s.fl_n);
              const isActive = active && active.id === s.id;
              const r = isActive ? 9 : Math.max(4, Math.min(8, s.mult * 2));
              return (
                <g key={s.id}
                  onMouseEnter={() => setHovered(s)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => setSelected(sel => sel?.id === s.id ? null : s)}
                  style={{cursor:"pointer"}}>
                  {isActive && (
                    <circle cx={cx} cy={cy} r={r+5} fill={col} opacity={0.2}/>
                  )}
                  <circle cx={cx} cy={cy} r={r}
                    fill={col} opacity={isActive ? 1 : 0.75}
                    stroke={isActive ? col : "transparent"}
                    strokeWidth={2}/>
                  {/* Nomor sektor untuk yang aktif */}
                  {isActive && (
                    <text x={cx} y={cy+3} textAnchor="middle"
                      fontSize={7} fill="#0f172a" fontWeight="800"
                      fontFamily="monospace">{s.id}</text>
                  )}
                  {/* Label untuk sektor kunci (BL>1 & FL>1) */}
                  {(!isActive && s.bl_n > 1 && s.fl_n > 1 && filterGrp==="Semua") && (
                    <text x={cx} y={cy-r-3} textAnchor="middle"
                      fontSize={7} fill={col} fontFamily="Arial"
                      style={{pointerEvents:"none"}}>
                      {s.id}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Tooltip untuk hovered */}
            {hovered && (() => {
              const cx = toX(hovered.bl_n);
              const cy = toY(hovered.fl_n);
              const tx = cx > W*0.65 ? cx - 140 : cx + 12;
              const ty = cy < PAD + 70 ? cy + 8 : cy - 70;
              return (
                <g>
                  <rect x={tx} y={ty} width={138} height={66} rx={5}
                    fill="#1e293b" stroke="#334155" strokeWidth={1}/>
                  <text x={tx+8} y={ty+14} fontSize={9} fill="#f8fafc"
                    fontWeight="700" fontFamily="Arial">
                    {hovered.id}. {hovered.nama.slice(0,20)}
                  </text>
                  <text x={tx+8} y={ty+26} fontSize={8} fill="#94a3b8" fontFamily="monospace">
                    BL: {hovered.bl_n.toFixed(3)}
                  </text>
                  <text x={tx+8} y={ty+37} fontSize={8} fill="#94a3b8" fontFamily="monospace">
                    FL: {hovered.fl_n.toFixed(3)}
                  </text>
                  <text x={tx+8} y={ty+48} fontSize={8} fill="#94a3b8" fontFamily="monospace">
                    Mult: {hovered.mult.toFixed(3)}
                  </text>
                  <text x={tx+8} y={ty+60} fontSize={8}
                    fill={quadColor(hovered.bl_n,hovered.fl_n)} fontFamily="Arial" fontWeight="700">
                    {quadLabel(hovered.bl_n,hovered.fl_n)}
                  </text>
                </g>
              );
            })()}
          </svg>
        </div>

        {/* Panel info kanan */}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {/* Ringkasan per kuadran */}
          <div style={card}>
            <div style={{fontSize:11,color:"#64748b",...mono,marginBottom:10}}>DISTRIBUSI KUADRAN</div>
            {[
              ["I — Kunci",      counts.kunci,    "#22c55e", "BL>1 & FL>1 — Prioritas utama"],
              ["II — Pemimpin",  counts.pemimpin, "#0ea5e9", "BL≤1 & FL>1 — Lokomotif hilir"],
              ["III — Pengikut", counts.pengikut, "#f59e0b", "BL>1 & FL≤1 — Penyerap input"],
              ["IV — Independen",counts.indepen,  "#64748b", "BL≤1 & FL≤1 — Terisolasi"],
            ].map(([lbl,cnt,c,desc])=>(
              <div key={lbl} style={{marginBottom:8,padding:"8px 10px",
                background:`${c}12`,borderRadius:6,borderLeft:`3px solid ${c}`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                  <span style={{fontSize:11,fontWeight:700,color:c}}>{lbl}</span>
                  <span style={{fontSize:14,fontWeight:800,color:c,...mono}}>{cnt}</span>
                </div>
                <div style={{fontSize:10,color:"#64748b"}}>{desc}</div>
                <div style={{marginTop:4,background:"#1e293b",borderRadius:2,height:3}}>
                  <div style={{width:`${(cnt/sektor.length*100).toFixed(0)}%`,
                    height:"100%",background:c,borderRadius:2}}/>
                </div>
              </div>
            ))}
          </div>

          {/* Detail sektor dipilih */}
          {active ? (
            <div style={{...card,borderTop:`2px solid ${quadColor(active.bl_n,active.fl_n)}`}}>
              <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:8}}>DETAIL SEKTOR</div>
              <div style={{fontSize:13,fontWeight:700,color:"#f1f5f9",marginBottom:4}}>
                {active.id}. {active.nama}
              </div>
              <div style={{marginBottom:8}}>
                <Badge c={GRP[active.grp]||"#22c55e"}>{active.grp}</Badge>
                {" "}
                <Badge c={quadColor(active.bl_n,active.fl_n)}>{quadLabel(active.bl_n,active.fl_n)}</Badge>
              </div>
              {[
                ["Backward Linkage", active.bl_n.toFixed(3), "#f59e0b"],
                ["Forward Linkage",  active.fl_n.toFixed(3), "#0ea5e9"],
                ["Multiplier Output",active.mult.toFixed(3), "#ec4899"],
                ["Output (Juta Rp)", fmt(active.output),     "#22c55e"],
                ["NTB (Juta Rp)",    fmt(active.ntb),        "#22c55e"],
                ["VA/Output",        (active.ntb/active.output*100).toFixed(1)+"%","#8b5cf6"],
              ].map(([k,v,c])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between",
                  padding:"5px 0",borderBottom:"1px solid #1e293b",fontSize:11}}>
                  <span style={{color:"#94a3b8"}}>{k}</span>
                  <span style={{color:c,fontWeight:700,...mono}}>{v}</span>
                </div>
              ))}
              <div style={{marginTop:10,padding:"8px 10px",
                background:`${quadColor(active.bl_n,active.fl_n)}15`,
                borderRadius:6,fontSize:10,color:"#94a3b8",lineHeight:1.6}}>
                {active.bl_n>1&&active.fl_n>1 &&
                  "Sektor kunci: dampak ke depan dan belakang di atas rata-rata. Prioritas investasi untuk efisiensi ekonomi maksimal."}
                {active.bl_n<=1&&active.fl_n>1 &&
                  "Sektor pemimpin: kuat ke depan (FL tinggi). Cocok sebagai lokomotif hilirisasi dan penggerak industri hilir."}
                {active.bl_n>1&&active.fl_n<=1 &&
                  "Sektor pengikut: kuat ke belakang (BL tinggi). Pertumbuhannya menggerakkan banyak sektor hulu."}
                {active.bl_n<=1&&active.fl_n<=1 &&
                  "Sektor independen: relatif terisolasi. Perlu penguatan keterkaitan hulu-hilir sebelum dijadikan prioritas."}
              </div>
            </div>
          ) : (
            <div style={{...card,textAlign:"center",color:"#475569",fontSize:12,padding:20}}>
              <div style={{fontSize:24,marginBottom:8}}>👆</div>
              Klik titik sektor pada grafik untuk melihat detail lengkap
            </div>
          )}

          {/* Daftar sektor kunci */}
          <div style={card}>
            <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:8}}>
              SEKTOR KUNCI (BL & FL &gt; 1)
            </div>
            {sektor.filter(s=>s.bl_n>1&&s.fl_n>1).length === 0 ? (
              <div style={{fontSize:11,color:"#475569"}}>Tidak ada sektor kunci</div>
            ) : (
              sektor.filter(s=>s.bl_n>1&&s.fl_n>1)
                .sort((a,b)=>(b.bl_n+b.fl_n)-(a.bl_n+a.fl_n))
                .map(s=>(
                <div key={s.id}
                  onClick={()=>setSelected(sel=>sel?.id===s.id?null:s)}
                  style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,
                    cursor:"pointer",padding:"5px 8px",borderRadius:6,
                    background:selected?.id===s.id?"#0f2d1a":"transparent",
                    border:`1px solid ${selected?.id===s.id?"#22c55e":"transparent"}`}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:"#22c55e",flexShrink:0}}/>
                  <span style={{fontSize:10,color:"#e2e8f0",flex:1}}>{s.id}. {s.nama.slice(0,20)}</span>
                  <span style={{fontSize:9,color:"#22c55e",...mono}}>{(s.bl_n+s.fl_n).toFixed(2)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB CONTOH ANALISIS KOMPREHENSIF — M@I-2026
// ═══════════════════════════════════════════════════════════════
function ContohAnalisis({ sektor, makro, D }) {
  const [activeCase, setActiveCase] = useState("simulasi");
  const [showStep, setShowStep] = useState(null);

  // Data hasil simulasi yang sudah dikompilasi untuk contoh
  // Sektor: Industri Pengolahan Ikan (id=11, Perikanan) — shock investasi Rp 300.000 Jt
  const contohCGE = {
    sektor: "Industri Pengolahan Ikan",
    jenis: "investasi",
    shock: 300000,
    mult: 1.623,
    effectiveMult: 1.623,
    total: 486900,
    direct: 300000,
    indirect: 186900,
    roundOne: 135000,
    roundTwo: 51900,
    incomeEff: 87200,
    consumpEff: 59296,
    govRevEff: 14607,
    employEff: 1840,
    gdpEff: 0.54,
    importLeakage: 36000,
    bl_n: 1.12, fl_n: 0.89,
    sectorImpact: [
      {nama:"Perikanan", grp:"Perikanan", dampak:89400, pct:18.4},
      {nama:"Industri Makanan",grp:"Industri", dampak:74200, pct:15.2},
      {nama:"Perdagangan",grp:"Jasa", dampak:52100, pct:10.7},
      {nama:"Transportasi",grp:"Jasa", dampak:43800, pct:9.0},
      {nama:"Jasa Lainnya",grp:"Jasa", dampak:38900, pct:8.0},
    ]
  };

  // Contoh komparasi dua kebijakan
  const scenA = { nama:"Investasi Pengolahan Ikan", shock:300000, mult:1.623, total:486900,
    gdpEff:0.54, employEff:1840, incomeEff:87200, sektor:"Ind. Ikan", jenis:"investasi" };
  const scenB = { nama:"Subsidi Pertanian Padi", shock:300000, mult:1.16*0.82, total:285360,
    gdpEff:0.31, employEff:2640, incomeEff:63100, sektor:"Padi", jenis:"subsidi" };

  // LES hasil
  const lesEx = [
    {nama:"Makanan & Minuman",  eta:0.72, dC_pct:0.39, dC:18919},
    {nama:"Pakaian & Sandang",  eta:1.05, dC_pct:0.58, dC:2479},
    {nama:"Perumahan & Fasil.", eta:0.85, dC_pct:0.47, dC:4558},
    {nama:"Kesehatan & Pddk",   eta:1.20, dC_pct:0.66, dC:3923},
    {nama:"Transportasi",       eta:1.35, dC_pct:0.74, dC:19598},
    {nama:"Hotel & Resto",      eta:1.15, dC_pct:0.63, dC:4862},
    {nama:"Lainnya",            eta:1.10, dC_pct:0.61, dC:1017},
  ];

  const cardSty = { ...{
    background:"var(--bg2,#0f172a)",border:"0.5px solid #1e293b",
    borderRadius:10,padding:"14px 16px",marginBottom:12
  }};

  const cases = [
    ["simulasi","⚡ Simulasi CGE"],
    ["komparasi","⚖️ Komparasi Kebijakan"],
    ["les","🛒 Pola Konsumsi LES"],
    ["ihp","📈 Dampak Harga"],
    ["keterkaitan","🔗 Analisis Keterkaitan"],
  ];

  const Badge = ({c,children}) => (
    <span style={{padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:700,
      background:c+"22",color:c,border:"1px solid "+c+"44"}}>{children}</span>
  );

  const InfoBox = ({color,icon,title,children}) => (
    <div style={{background:color+"0f",borderLeft:"3px solid "+color,borderRadius:"0 8px 8px 0",
      padding:"10px 14px",marginBottom:10,fontSize:11,color:"#94a3b8",lineHeight:1.7}}>
      <strong style={{color,display:"block",marginBottom:4}}>{icon} {title}</strong>
      {children}
    </div>
  );

  return (
    <div style={{padding:"0 0 40px"}}>

      {/* HEADER */}
      <div style={{background:"linear-gradient(135deg,#0a1628,#0f2d1a)",borderRadius:12,
        padding:"24px 28px",marginBottom:20,position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-20,right:-20,width:160,height:160,
          borderRadius:"50%",background:"#22c55e08"}}/>
        <div style={{fontSize:10,color:"#22c55e",...mono,letterSpacing:3,marginBottom:8}}>
          CONTOH ANALISIS KOMPREHENSIF · M@I-2026
        </div>
        <h2 style={{fontSize:22,fontWeight:800,color:"#f1f5f9",margin:"0 0 8px"}}>
          Analisis Dampak Investasi di Kabupaten Rembang
        </h2>
        <p style={{fontSize:12,color:"#64748b",lineHeight:1.7,maxWidth:700,margin:0}}>
          Studi kasus: Dampak investasi sektor pengolahan ikan senilai Rp 300 Miliar terhadap
          perekonomian Kabupaten Rembang tahun 2016. Analisis menggunakan Model CGE dengan
          data I-O hasil regionalisasi RAS dari I-O Kab. Jepara.
          Mencakup: simulasi multiplier, dekomposisi dampak, komparasi kebijakan,
          pola konsumsi LES, dan estimasi dampak harga.
        </p>
        <div style={{display:"flex",gap:8,marginTop:14,flexWrap:"wrap"}}>
          <Badge c="#22c55e">Kab. Rembang 2016</Badge>
          <Badge c="#0ea5e9">I-O 30 Sektor (RAS)</Badge>
          <Badge c="#f59e0b">SAM 7×7</Badge>
          <Badge c="#8b5cf6">Model CGE Linier</Badge>
          <Badge c="#ec4899">M@I-2026</Badge>
        </div>
      </div>

      {/* Sub-tab navigasi */}
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {cases.map(([k,l])=>(
          <button key={k} onClick={()=>setActiveCase(k)}
            style={{padding:"6px 16px",borderRadius:20,border:"none",cursor:"pointer",fontSize:11,
              fontWeight:700,background:activeCase===k?"#22c55e":"#1e293b",
              color:activeCase===k?"#0f172a":"#64748b",transition:"all 0.2s"}}>
            {l}
          </button>
        ))}
      </div>

      {/* ── CASE 1: SIMULASI CGE ── */}
      {activeCase==="simulasi"&&(
        <div>
          <div style={cardSty}>
            <div style={{fontSize:10,color:"#22c55e",...mono,marginBottom:12,letterSpacing:2}}>
              LANGKAH 1 — KONFIGURASI SIMULASI
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
              {[
                ["Sektor Target","Industri Pengolahan Ikan (Sektor 11)","#22c55e"],
                ["Jenis Kebijakan","Investasi (PMTB)","#0ea5e9"],
                ["Besar Shock","Rp 300.000 Juta (≈ Rp 300 Miliar)","#f59e0b"],
              ].map(([l,v,c])=>(
                <div key={l} style={{background:"#0a1628",borderRadius:8,padding:"10px 12px"}}>
                  <div style={{fontSize:9,color:"#475569",...mono}}>{l}</div>
                  <div style={{fontSize:12,fontWeight:700,color:c,marginTop:2}}>{v}</div>
                </div>
              ))}
            </div>
            <InfoBox color="#0ea5e9" icon="ℹ️" title="Mengapa sektor ini?">
              Industri pengolahan ikan dipilih karena: (1) Rembang adalah kabupaten pesisir dengan
              armada nelayan terbesar di Jawa Tengah, (2) sektor ini berada di Kuadran III
              (BL=1.12 &gt; 1, FL=0.89 &lt; 1) — artinya kuat menarik input dari hulu (nelayan,
              pakan, es, garam) meski belum optimal sebagai pemasok ke depan.
              Investasi sebesar Rp 300 M adalah skala realistis untuk program revitalisasi
              cold storage dan unit pengolahan ikan (UPI) di TPI Tasik Agung.
            </InfoBox>
          </div>

          <div style={cardSty}>
            <div style={{fontSize:10,color:"#22c55e",...mono,marginBottom:12,letterSpacing:2}}>
              LANGKAH 2 — HASIL SIMULASI & MULTIPLIER
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
              {[
                ["Multiplier Output","1.623×","#ec4899","Setiap Rp 1 investasi menciptakan Rp 1.623 output"],
                ["Total Dampak Output","Rp 486.900 Jt","#22c55e","Lebih besar dari shock awal (leverage effect)"],
                ["Dampak ke PDRB","+0.54%","#0ea5e9","PDRB Rembang naik dari Rp 14.871 M → Rp 14.952 M"],
                ["Est. Lapangan Kerja","~1.840 org","#f59e0b","Penyerapan TK langsung dan tidak langsung"],
              ].map(([l,v,c,desc])=>(
                <div key={l} style={{background:"#0a1628",borderRadius:8,padding:"10px 12px",
                  borderTop:"2px solid "+c}}>
                  <div style={{fontSize:9,color:"#475569",...mono,marginBottom:4}}>{l}</div>
                  <div style={{fontSize:16,fontWeight:800,color:c,...mono}}>{v}</div>
                  <div style={{fontSize:9,color:"#475569",marginTop:4,lineHeight:1.5}}>{desc}</div>
                </div>
              ))}
            </div>

            {/* Dekomposisi dampak */}
            <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:8}}>DEKOMPOSISI DAMPAK (Linierisasi CGE)</div>
            {[
              ["D","Efek Langsung",     contohCGE.direct,   "#22c55e","Injeksi awal ke sektor pengolahan ikan"],
              ["I","Efek Tak Langsung", contohCGE.indirect, "#0ea5e9","Perikanan tangkap, es, garam, transportasi teraktivasi"],
              ["Y","Efek Pendapatan",   contohCGE.incomeEff,"#f59e0b","Upah TK naik → RT belanja lebih banyak"],
              ["G","Efek Fiskal",       contohCGE.govRevEff,"#06b6d4","Pajak daerah & PPh meningkat"],
              ["M","Kebocoran Impor",   -contohCGE.importLeakage,"#ef4444","Bahan baku (bahan kemasan, mesin) diimpor"],
            ].map(([sym,lbl,val,col,desc])=>(
              <div key={sym} style={{display:"flex",alignItems:"center",gap:10,marginBottom:7}}>
                <div style={{width:22,height:22,borderRadius:"50%",background:col+"22",
                  border:"1px solid "+col,display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:10,fontWeight:700,color:col,flexShrink:0}}>{sym}</div>
                <div style={{width:160,fontSize:11,color:"#e2e8f0",flexShrink:0}}>{lbl}</div>
                <div style={{flex:1,height:16,background:"#1e293b",borderRadius:3,overflow:"hidden"}}>
                  <div style={{width:Math.abs(val)/contohCGE.total*100+"%",height:"100%",
                    background:col,opacity:0.8,transition:"width 0.5s"}}/>
                </div>
                <div style={{width:90,textAlign:"right",fontSize:10,...mono,
                  color:val<0?"#ef4444":col,fontWeight:600}}>
                  {val>=0?"+":""}{(val/1000).toFixed(0)} M
                </div>
                <div style={{width:220,fontSize:9,color:"#475569",lineHeight:1.4}}>{desc}</div>
              </div>
            ))}

            <InfoBox color="#22c55e" icon="📌" title="Interpretasi Multiplier 1.623×">
              Multiplier 1.623 berarti setiap Rp 1 Miliar investasi di sektor pengolahan ikan
              menciptakan <strong style={{color:"#22c55e"}}>Rp 1,623 Miliar output total</strong> di
              seluruh perekonomian Rembang. Dari Rp 300 M shock, Rp 186,9 M (38.4%) adalah efek
              berganda yang menyebar ke sektor lain. Multiplier ini lebih kecil dari Listrik/Gas
              (4.704) tapi lebih tinggi dari Pertanian Padi (1.16) — menunjukkan posisi
              middle-tier yang masih dapat ditingkatkan lewat penguatan rantai pasok lokal.
            </InfoBox>

            {/* Distribusi sektoral */}
            <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:8,marginTop:4}}>
              DISTRIBUSI DAMPAK KE SEKTOR LAIN (Top 5)
            </div>
            {contohCGE.sectorImpact.map((s,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                <div style={{width:16,textAlign:"right",fontSize:10,color:"#475569",...mono}}>{i+1}</div>
                <div style={{width:160,fontSize:11,color:"#e2e8f0"}}>{s.nama}</div>
                <div style={{flex:1,height:14,background:"#1e293b",borderRadius:3,overflow:"hidden"}}>
                  <div style={{width:s.pct+"%",height:"100%",
                    background:s.grp==="Perikanan"?"#22c55e":s.grp==="Industri"?"#f59e0b":"#0ea5e9",
                    opacity:0.8}}/>
                </div>
                <div style={{width:70,textAlign:"right",fontSize:10,...mono,color:"#f1f5f9"}}>
                  {s.pct}%
                </div>
                <div style={{width:100,textAlign:"right",fontSize:10,...mono,color:"#64748b"}}>
                  Rp {(s.dampak/1000).toFixed(0)}M
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── CASE 2: KOMPARASI ── */}
      {activeCase==="komparasi"&&(
        <div>
          <div style={cardSty}>
            <div style={{fontSize:10,color:"#f97316",...mono,marginBottom:12,letterSpacing:2}}>
              KOMPARASI KEBIJAKAN — ANGGARAN SAMA Rp 300 MILIAR
            </div>
            <InfoBox color="#f97316" icon="❓" title="Pertanyaan Kebijakan">
              Pemerintah Kabupaten Rembang memiliki anggaran Rp 300 Miliar. Mana yang lebih
              efektif: (A) Investasi pembangunan pabrik pengolahan ikan, atau (B) Subsidi
              sarana produksi pertanian (padi)? Analisis CGE memberikan jawabannya secara kuantitatif.
            </InfoBox>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              {[scenA,scenB].map((sc,idx)=>(
                <div key={idx} style={{background:"#0a1628",borderRadius:8,padding:"12px 14px",
                  borderTop:"3px solid "+(idx===0?"#22c55e":"#f97316")}}>
                  <div style={{fontSize:11,fontWeight:700,color:idx===0?"#22c55e":"#f97316",marginBottom:10}}>
                    {idx===0?"Skenario A":"Skenario B"}: {sc.nama}
                  </div>
                  {[
                    ["Sektor",sc.sektor],["Jenis",sc.jenis],
                    ["Shock","Rp "+sc.shock.toLocaleString("id-ID")+" Jt"],
                  ].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",
                      padding:"3px 0",fontSize:11,borderBottom:"1px solid #1e293b"}}>
                      <span style={{color:"#64748b"}}>{l}</span>
                      <span style={{color:"#e2e8f0"}}>{v}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Tabel hasil komparasi */}
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{background:"#1e293b"}}>
                <th style={{padding:"8px 10px",textAlign:"left",color:"#64748b",...mono,fontSize:10,borderBottom:"1px solid #334155"}}>Indikator</th>
                <th style={{padding:"8px 10px",textAlign:"right",color:"#22c55e",...mono,fontSize:10,borderBottom:"1px solid #334155"}}>A: Investasi Ikan</th>
                <th style={{padding:"8px 10px",textAlign:"right",color:"#f97316",...mono,fontSize:10,borderBottom:"1px solid #334155"}}>B: Subsidi Padi</th>
                <th style={{padding:"8px 10px",textAlign:"center",color:"#f1f5f9",...mono,fontSize:10,borderBottom:"1px solid #334155"}}>Unggul</th>
              </tr></thead>
              <tbody>
                {[
                  ["Multiplier Output","1.623×","0.951×","A"],
                  ["Total Dampak Output","Rp 486.900 Jt","Rp 285.360 Jt","A"],
                  ["Dampak PDRB","+0.54%","+0.31%","A"],
                  ["Dampak Pendapatan TK","Rp 87.200 Jt","Rp 63.100 Jt","A"],
                  ["Est. Lapangan Kerja","~1.840 org","~2.640 org","B"],
                  ["Penerimaan Pajak Daerah","Rp 14.607 Jt","Rp 4.281 Jt","A"],
                  ["Efisiensi Output/Rp","1.623 Rp/Rp","0.951 Rp/Rp","A"],
                  ["Dampak Harga Konsumen (IHK)","-0.04%","-0.06%","B"],
                ].map(([ind,vA,vB,win])=>(
                  <tr key={ind} style={{borderBottom:"1px solid #0f172a",
                    background:ind.includes("Efisiensi")?"#0f2d1a":"transparent"}}>
                    <td style={{padding:"7px 10px",color:ind.includes("Efisiensi")?"#22c55e":"#94a3b8",
                      fontWeight:ind.includes("Efisiensi")?700:400}}>{ind}</td>
                    <td style={{padding:"7px 10px",textAlign:"right",...mono,
                      color:win==="A"?"#22c55e":"#e2e8f0",fontWeight:win==="A"?700:400}}>{vA}</td>
                    <td style={{padding:"7px 10px",textAlign:"right",...mono,
                      color:win==="B"?"#f97316":"#e2e8f0",fontWeight:win==="B"?700:400}}>{vB}</td>
                    <td style={{padding:"7px 10px",textAlign:"center"}}>
                      <span style={{padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700,
                        background:win==="A"?"#22c55e22":"#f9731622",
                        color:win==="A"?"#22c55e":"#f97316"}}>{win} ✓</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <InfoBox color="#22c55e" icon="🏆" title="Rekomendasi Analisis">
              <strong style={{color:"#22c55e"}}>Skenario A (Investasi Pengolahan Ikan) lebih unggul di 6 dari 8 indikator.</strong>{" "}
              Multiplier 1.623× vs 0.951× menunjukkan bahwa setiap rupiah investasi di pengolahan ikan
              menghasilkan output 71% lebih banyak dibanding subsidi padi.{" "}
              <strong style={{color:"#f97316"}}>Skenario B unggul dalam penyerapan TK</strong>{" "}
              (2.640 vs 1.840 orang) — subsidi pertanian memang lebih padat karya.{" "}
              <em style={{color:"#475569"}}>Rekomendasi: Jika prioritas adalah pertumbuhan ekonomi dan
              penerimaan fiskal, pilih A. Jika prioritas adalah pengentasan kemiskinan dan
              penyerapan TK pedesaan, pertimbangkan B atau kombinasi keduanya.</em>
            </InfoBox>
          </div>
        </div>
      )}

      {/* ── CASE 3: LES ── */}
      {activeCase==="les"&&(
        <div>
          <div style={cardSty}>
            <div style={{fontSize:10,color:"#0ea5e9",...mono,marginBottom:12,letterSpacing:2}}>
              POLA KONSUMSI RT — MODEL LES / STONE-GEARY
            </div>
            <InfoBox color="#0ea5e9" icon="🛒" title="Konteks">
              Investasi Rp 300 M di pengolahan ikan meningkatkan upah TK sebesar Rp 87.200 Juta
              (+0.836% dari konsumsi RT base). Model LES menghitung bagaimana kenaikan pendapatan
              ini didistribusikan ke 7 kelompok komoditas — hasilnya berbeda dari asumsi
              MPC konstan karena memperhitungkan konsumsi minimum (subsisten) tiap komoditas.
            </InfoBox>

            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
              {[
                ["Δ Pendapatan RT","+0.836%","#f59e0b"],
                ["Δ Konsumsi Total","+Rp 87.174 Jt","#22c55e"],
                ["MPC Efektif LES","0.9997","#0ea5e9"],
              ].map(([l,v,c])=>(
                <div key={l} style={{background:"#0a1628",borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
                  <div style={{fontSize:9,color:"#475569",...mono}}>{l}</div>
                  <div style={{fontSize:14,fontWeight:700,color:c,...mono,marginTop:3}}>{v}</div>
                </div>
              ))}
            </div>

            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,marginBottom:14}}>
              <thead><tr style={{background:"#1e293b"}}>
                {["Komoditas","η Elast.","C Base","C Baru","ΔC","%Δ","Klasifikasi"].map(h=>(
                  <th key={h} style={{padding:"7px 9px",textAlign:h==="Komoditas"?"left":"right",
                    color:"#64748b",...mono,fontSize:9,borderBottom:"1px solid #334155"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {lesEx.map((r,i)=>{
                  const colors=["#22c55e","#0ea5e9","#f59e0b","#f97316","#8b5cf6","#ec4899","#06b6d4"];
                  const Ci=[4848417,427495,969683,594322,2648383,771576,166827];
                  return (
                    <tr key={i} style={{borderBottom:"1px solid #0f172a",
                      background:i%2===0?"#0f172a":"#0a1628"}}>
                      <td style={{padding:"6px 9px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <div style={{width:7,height:7,borderRadius:"50%",background:colors[i]}}/>
                          <span style={{color:"#e2e8f0"}}>{r.nama}</span>
                        </div>
                      </td>
                      <td style={{padding:"6px 9px",textAlign:"right",...mono,
                        color:r.eta>1?"#f59e0b":"#94a3b8"}}>{r.eta.toFixed(2)}</td>
                      <td style={{padding:"6px 9px",textAlign:"right",...mono,color:"#64748b"}}>
                        {Ci[i].toLocaleString("id-ID")}</td>
                      <td style={{padding:"6px 9px",textAlign:"right",...mono,color:"#f1f5f9"}}>
                        {(Ci[i]+r.dC).toLocaleString("id-ID")}</td>
                      <td style={{padding:"6px 9px",textAlign:"right",...mono,
                        color:"#22c55e",fontWeight:700}}>+{r.dC.toLocaleString("id-ID")}</td>
                      <td style={{padding:"6px 9px",textAlign:"right",...mono}}>
                        <span style={{color:"#22c55e"}}>+{r.dC_pct.toFixed(2)}%</span>
                      </td>
                      <td style={{padding:"6px 9px",textAlign:"right"}}>
                        <span style={{fontSize:9,padding:"2px 7px",borderRadius:10,
                          background:r.eta>1?"#f59e0b22":"#94a3b822",
                          color:r.eta>1?"#f59e0b":"#94a3b8"}}>
                          {r.eta>1?"mewah":"kebutuhan"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <InfoBox color="#f59e0b" icon="📌" title="Interpretasi Pola Konsumsi LES">
              Kenaikan pendapatan RT +0.836% dari shock investasi pengolahan ikan
              menghasilkan distribusi konsumsi yang <strong style={{color:"#f59e0b"}}>tidak proporsional</strong>:{" "}
              Transportasi (+0.74%) dan Kesehatan & Pendidikan (+0.66%) tumbuh lebih cepat
              dari rata-rata karena η&gt;1 (barang superior). Makanan & Minuman (+0.39%) tumbuh
              lebih lambat meski nilainya terbesar (Rp 18.919 Jt) karena η=0.72 (kebutuhan pokok).
              Artinya: investasi di sektor ikan tidak hanya meningkatkan konsumsi pangan —
              ia mendorong RT Rembang untuk lebih banyak berinvestasi pada pendidikan, kesehatan,
              dan mobilitas. <em style={{color:"#475569"}}>Temuan ini tidak bisa diperoleh dari
              asumsi MPC konstan 0.68.</em>
            </InfoBox>
          </div>
        </div>
      )}

      {/* ── CASE 4: IHP/IHK ── */}
      {activeCase==="ihp"&&(
        <div>
          <div style={cardSty}>
            <div style={{fontSize:10,color:"#f97316",...mono,marginBottom:12,letterSpacing:2}}>
              ESTIMASI DAMPAK HARGA — IHP & IHK ENDOGEN
            </div>
            <InfoBox color="#f97316" icon="📈" title="Konteks Analisis Harga">
              Investasi Rp 300 M menghasilkan ΔGDP = +0.54%. Ini memiliki dua efek harga yang
              berlawanan: (1) Output naik → sisi penawaran → harga cenderung turun (deflasi supply);
              (2) Pendapatan naik → permintaan meningkat → harga cenderung naik (inflasi demand).
              IHP dan IHK menangkap resultan kedua efek ini.
            </InfoBox>

            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
              {[
                ["Δ IHP (Produsen)","-0.108%","#22c55e","Supply-side mendominasi"],
                ["Δ IHK (Konsumen)","-0.052%","#22c55e","Harga konsumen turun tipis"],
                ["Pendapatan Riil RT","+0.598%","#22c55e","Nominal+PDRB − deflasi IHK"],
                ["Spread IHP−IHK","-0.056%","#8b5cf6","Produsen deflasi > Konsumen"],
              ].map(([l,v,c,desc])=>(
                <div key={l} style={{background:"#0a1628",borderRadius:8,padding:"10px 12px",
                  textAlign:"center",borderTop:"2px solid "+c}}>
                  <div style={{fontSize:9,color:"#64748b",...mono,marginBottom:4}}>{l}</div>
                  <div style={{fontSize:18,fontWeight:800,color:c,...mono}}>{v}</div>
                  <div style={{fontSize:9,color:"#475569",marginTop:3}}>{desc}</div>
                </div>
              ))}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div>
                <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:8}}>IHP PER SEKTOR PRODUSEN</div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead><tr style={{background:"#1e293b"}}>
                    {["Sektor","ΔOutput","ΔHarga","Kontrib."].map(h=>(
                      <th key={h} style={{padding:"6px 8px",textAlign:h==="Sektor"?"left":"right",
                        color:"#64748b",...mono,fontSize:9,borderBottom:"1px solid #334155"}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {[
                      ["Pertanian",0.22,"+0.81%","-0.135%","-0.030%"],
                      ["Perikanan",0.03,"+4.21%","-1.155%","-0.035%"],
                      ["Pertambangan",0.05,"+0.42%","-0.018%","-0.001%"],
                      ["Industri",0.24,"+2.87%","-0.754%","-0.181%"],
                      ["Utilitas",0.02,"+1.10%","-0.222%","-0.004%"],
                      ["Konstruksi",0.10,"+0.64%","-0.084%","-0.008%"],
                      ["Jasa",0.34,"+0.71%","-0.105%","-0.036%"],
                    ].map(([g,w,dQ,dP,k])=>(
                      <tr key={g} style={{borderBottom:"1px solid #0f172a",
                        background:g==="Industri"||g==="Perikanan"?"#0f172a":"#0a1628"}}>
                        <td style={{padding:"5px 8px",color:"#e2e8f0",fontSize:10}}>{g}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",...mono,fontSize:10,color:"#22c55e"}}>{dQ}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",...mono,fontSize:10,color:"#22c55e"}}>{dP}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",...mono,fontSize:10,
                          color:"#22c55e",fontWeight:700}}>{k}</td>
                      </tr>
                    ))}
                    <tr style={{background:"#0a1628",borderTop:"2px solid #334155"}}>
                      <td colSpan={3} style={{padding:"5px 8px",fontWeight:700,color:"#f8fafc",fontSize:10}}>
                        Δ IHP Total</td>
                      <td style={{padding:"5px 8px",textAlign:"right",fontWeight:800,...mono,
                        fontSize:11,color:"#22c55e"}}>-0.108%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div>
                <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:8}}>IHK PER KELOMPOK KONSUMEN</div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead><tr style={{background:"#1e293b"}}>
                    {["Komoditas","Bobot","ΔHarga","Kontrib."].map(h=>(
                      <th key={h} style={{padding:"6px 8px",textAlign:h==="Komoditas"?"left":"right",
                        color:"#64748b",...mono,fontSize:9,borderBottom:"1px solid #334155"}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {[
                      ["Makanan","46.5%","-0.135%","-0.063%"],
                      ["Pakaian","4.1%","-0.754%","-0.031%"],
                      ["Perumahan","9.3%","-0.084%","-0.008%"],
                      ["Kes. & Pddk","5.7%","-0.105%","-0.006%"],
                      ["Transportasi","25.4%","-0.018%","-0.005%"],
                      ["Hotel & Resto","7.4%","-0.105%","-0.008%"],
                      ["Lainnya","1.6%","-0.105%","-0.002%"],
                    ].map(([k,w,dP,ko])=>(
                      <tr key={k} style={{borderBottom:"1px solid #0f172a",
                        background:k==="Makanan"?"#0f172a":"#0a1628"}}>
                        <td style={{padding:"5px 8px",color:"#e2e8f0",fontSize:10}}>{k}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",...mono,fontSize:10,color:"#64748b"}}>{w}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",...mono,fontSize:10,color:"#22c55e"}}>{dP}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",...mono,fontSize:10,
                          color:"#22c55e",fontWeight:700}}>{ko}</td>
                      </tr>
                    ))}
                    <tr style={{background:"#0a1628",borderTop:"2px solid #334155"}}>
                      <td colSpan={3} style={{padding:"5px 8px",fontWeight:700,color:"#f8fafc",fontSize:10}}>
                        Δ IHK Total</td>
                      <td style={{padding:"5px 8px",textAlign:"right",fontWeight:800,...mono,
                        fontSize:11,color:"#22c55e"}}>-0.052%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <InfoBox color="#22c55e" icon="📌" title="Interpretasi Dampak Harga">
              Investasi pengolahan ikan menghasilkan <strong style={{color:"#22c55e"}}>deflasi ringan</strong>{" "}
              di sisi produsen (IHP −0.108%) dan konsumen (IHK −0.052%). Ini terjadi karena efek supply
              (output industri naik besar → harga turun) lebih kuat dari efek demand (ΔGDP +0.54% kecil).
              Hasilnya: <strong style={{color:"#22c55e"}}>pendapatan riil RT naik +0.598%</strong>{" "}
              — lebih tinggi dari kenaikan nominal (+0.54%) karena harga juga turun.
              Sektor perikanan mengalami deflasi terbesar (−1.155%) karena produksi ikan meningkat paling
              signifikan akibat stimulus pengolahan. Ini <strong style={{color:"#f59e0b"}}>menguntungkan
              konsumen ikan</strong> namun perlu diantisipasi agar tidak menekan pendapatan nelayan kecil.
            </InfoBox>
          </div>
        </div>
      )}

      {/* ── CASE 5: KETERKAITAN ── */}
      {activeCase==="keterkaitan"&&(
        <div>
          <div style={cardSty}>
            <div style={{fontSize:10,color:"#f97316",...mono,marginBottom:12,letterSpacing:2}}>
              ANALISIS KETERKAITAN SEKTORAL — KONTEKS SIMULASI
            </div>
            <InfoBox color="#f97316" icon="🔗" title="Mengapa Keterkaitan Penting?">
              Sebelum memilih sektor target simulasi, analisis keterkaitan (BL & FL) memberikan
              dasar ilmiah. BL mengukur kemampuan sektor menarik input dari hulu;
              FL mengukur kemampuan sektor memasok ke hilir. Kombinasi keduanya menentukan
              posisi strategis sektor dalam perekonomian.
            </InfoBox>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div>
                <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:10}}>POSISI KUADRAN SEKTOR-SEKTOR KUNCI</div>
                {[
                  ["I — Sektor Kunci (BL>1 & FL>1)","#22c55e",[
                    "Perdagangan (BL=1.48, FL=2.67)",
                    "Industri Makanan (BL=1.78, FL=3.88)",
                    "Pertambangan (BL=1.21, FL=3.26)",
                  ]],
                  ["II — Pemimpin/Forward (BL≤1 & FL>1)","#0ea5e9",[
                    "Listrik/Gas/Air (FL=4.20, Mult=4.70)",
                  ]],
                  ["III — Pengikut/Backward (BL>1 & FL≤1)","#f59e0b",[
                    "Ind. Pengolahan Ikan (BL=1.12, FL=0.89)",
                    "Konstruksi (BL=1.15, FL=0.74)",
                  ]],
                  ["IV — Independen (BL≤1 & FL≤1)","#64748b",[
                    "Padi (BL=0.64, FL=0.97)",
                    "Peternakan (BL=0.78, FL=0.82)",
                  ]],
                ].map(([q,c,secs])=>(
                  <div key={q} style={{marginBottom:10,padding:"8px 12px",
                    background:c+"0f",borderRadius:8,borderLeft:"3px solid "+c}}>
                    <div style={{fontSize:10,fontWeight:700,color:c,marginBottom:6}}>{q}</div>
                    {secs.map(s=>(
                      <div key={s} style={{fontSize:10,color:"#94a3b8",
                        padding:"2px 0",display:"flex",alignItems:"center",gap:6}}>
                        <div style={{width:5,height:5,borderRadius:"50%",background:c,flexShrink:0}}/>
                        {s}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div>
                <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:10}}>IMPLIKASI UNTUK PEMILIHAN SEKTOR TARGET</div>
                {[
                  ["Ind. Pengolahan Ikan (Simulasi Kita)","#f59e0b",
                    "Kuadran III — Pengikut. BL=1.12 berarti setiap Rp 1 output membutuhkan input Rp 1.12 dari sektor lain (hulu kuat: nelayan, es, garam). Baik untuk kebijakan yang bertujuan mengaktifkan rantai pasok perikanan dari hulu ke bawah.",
                    "Potensi naik ke Kuadran I jika ada investasi hilir (cold storage, pasar ekspor) yang meningkatkan FL."],
                  ["Strategi Kebijakan Optimal","#22c55e",
                    "Untuk dampak maksimal: gabungkan investasi di Sektor Kunci (Kuadran I) dengan subsidi sektor pengikut (Kuadran III). Contoh: investasi Ind. Makanan (Kuadran I, mult=1.777) + subsidi Ind. Ikan (Kuadran III) menciptakan ekosistem rantai nilai perikanan-olahan yang lengkap.",
                    "Estimasi dampak gabungan: Rp 300M di Ind. Makanan → total Rp 533 M + Rp 300M subsidi Ind. Ikan → tambahan Rp 285 M = total dampak Rp 818 M dari anggaran Rp 600 M."],
                ].map(([title,c,desc,note])=>(
                  <div key={title} style={{marginBottom:12,padding:"10px 12px",
                    background:"#0a1628",borderRadius:8,borderTop:"2px solid "+c}}>
                    <div style={{fontSize:11,fontWeight:700,color:c,marginBottom:6}}>{title}</div>
                    <div style={{fontSize:10,color:"#94a3b8",lineHeight:1.6,marginBottom:6}}>{desc}</div>
                    <div style={{fontSize:10,color:"#475569",lineHeight:1.5,
                      borderTop:"1px solid #1e293b",paddingTop:6,fontStyle:"italic"}}>{note}</div>
                  </div>
                ))}
              </div>
            </div>

            <InfoBox color="#22c55e" icon="💡" title="Rekomendasi Berdasarkan Analisis Keterkaitan">
              Analisis keterkaitan Rembang menunjukkan bahwa <strong style={{color:"#f59e0b"}}>tidak ada
              sektor Kuadran I</strong> di Rembang 2016. Sektor dengan FL terkuat adalah
              <strong style={{color:"#0ea5e9"}}>Pertambangan (FL=3.22)</strong> dan
              <strong style={{color:"#0ea5e9"}}>Ind. Makanan & Min. (FL=2.10, Kuadran II)</strong>.
              Untuk pengembangan sektor perikanan, strategi optimal adalah:
              (1) <strong style={{color:"#0ea5e9"}}>Jangka pendek</strong>: Subsidi Ind. Ikan (BL&gt;1 — langsung aktifkan nelayan);
              (2) <strong style={{color:"#f59e0b"}}>Jangka menengah</strong>: Investasi Ind. Makanan & Min. (Kuadran II, FL=2.10) sebagai lokomotif hilir perikanan;
              (3) <strong style={{color:"#22c55e"}}>Jangka panjang</strong>: Dorong Ind. Ikan masuk Kuadran II lalu I melalui industri hilir
              (fillet, pengalengan, ekspor) sehingga FL naik dari 0.58 ke &gt; 1.
            </InfoBox>
          </div>
        </div>
      )}

      {/* FOOTER ANALISIS */}
      <div style={{background:"#0a1628",borderRadius:10,padding:"14px 18px",
        display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontSize:11,color:"#22c55e",fontWeight:700,...mono}}>M@I-2026</div>
          <div style={{fontSize:10,color:"#475569"}}>
            Analisis CGE Regional · Platform CGE Indonesia v2.0
          </div>
        </div>
        <div style={{fontSize:10,color:"#334155",...mono,textAlign:"right"}}>
          <div>Metodologi: Regionalisasi RAS · Matriks Leontief · SAM 7×7</div>
          <div>Referensi: Sugema & Holis (2015) · Oktaviani (2008) · BPS (2016)</div>
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// ANALISIS STRUKTURAL QUASI-DINAMIS — M@I-2026
// Referensi: Miller & Blair (2009) Bab 11
// ═══════════════════════════════════════════════════════════════
function computeLeontief(A) {
  const n = A.length;
  const M = A.map((row,i) => row.map((v,j) => (i===j?1:0) - v));
  const aug = M.map((row,i) => [...row, ...Array(n).fill(0).map((_,j)=>i===j?1:0)]);
  for (let col=0; col<n; col++) {
    let mx=col;
    for (let r=col+1; r<n; r++) if (Math.abs(aug[r][col])>Math.abs(aug[mx][col])) mx=r;
    [aug[col],aug[mx]]=[aug[mx],aug[col]];
    const pv=aug[col][col];
    if (Math.abs(pv)<1e-10) return null;
    for (let j=0;j<2*n;j++) aug[col][j]/=pv;
    for (let r=0;r<n;r++){
      if (r===col) continue;
      const f=aug[r][col];
      for (let j=0;j<2*n;j++) aug[r][j]-=f*aug[col][j];
    }
  }
  return aug.map(r=>r.slice(n));
}

function computeStructMetrics(A) {
  const L=computeLeontief(A);
  if (!L) return null;
  const n=A.length;
  const tot=L.flat().reduce((a,b)=>a+b,0);
  const BL=Array(n).fill(0).map((_,j)=>L.reduce((s,r)=>s+r[j],0)/(tot/n));
  const FL=Array(n).fill(0).map((_,i)=>L[i].reduce((a,b)=>a+b,0)/(tot/n));
  const mult=Array(n).fill(0).map((_,j)=>L.reduce((s,r)=>s+r[j],0));
  return {BL,FL,mult,L};
}

function getQ(bl,fl){
  if(bl>1&&fl>1) return {q:"I",label:"Kunci",    color:"#22c55e"};
  if(bl<=1&&fl>1) return {q:"II",label:"Pemimpin",color:"#0ea5e9"};
  if(bl>1&&fl<=1) return {q:"III",label:"Pengikut",color:"#f59e0b"};
  return {q:"IV",label:"Independen",color:"#64748b"};
}

function AnalisisStruktural({ sektor }) {
  const n = STRUCT.names.length;
  const [Amod,setAmod]     = useState(()=>STRUCT.A_orig.map(r=>[...r]));
  const [subTab,setSubTab] = useState("editor");
  const [selRow,setSelRow] = useState(0);
  const [changed,setChanged]= useState({});
  const [periode,setPeriode]= useState(5);
  const [targetQ,setTargetQ]= useState("II");
  const [hovIdx,setHovIdx]  = useState(null);

  const origM = useMemo(()=>({
    BL:  STRUCT.BL_orig,
    FL:  STRUCT.FL_orig,
    mult:STRUCT.mult_orig,
  }),[]);

  const modM = useMemo(()=>computeStructMetrics(Amod),[Amod]);

  const nChangedCells = Object.values(changed).filter(Boolean).length;

  const editA = (i,j,val) => {
    const orig=STRUCT.A_orig[i][j];
    const mn=Math.max(0,orig*0.7-0.005);
    const mx=Math.min(0.99,orig*1.3+0.01);
    const v=Math.max(mn,Math.min(mx,val));
    setAmod(prev=>prev.map((r,ri)=>r.map((c,ci)=>ri===i&&ci===j?v:c)));
    setChanged(prev=>({...prev,[i+"_"+j]:Math.abs(v-orig)>0.0001}));
  };

  const reset = () => { setAmod(STRUCT.A_orig.map(r=>[...r])); setChanged({}); };

  const quadDiff = useMemo(()=>{
    if (!modM) return [];
    return STRUCT.names.map((nm,i)=>({
      nm, i,
      oQ:getQ(origM.BL[i],origM.FL[i]),
      nQ:getQ(modM.BL[i],modM.FL[i]),
      moved:getQ(origM.BL[i],origM.FL[i]).q!==getQ(modM.BL[i],modM.FL[i]).q,
      dBL:modM.BL[i]-origM.BL[i],
      dFL:modM.FL[i]-origM.FL[i],
    }));
  },[modM,origM]);

  const periodeSteps = useMemo(()=>{
    const steps=[0,1,2,3,5,7,10,15].filter(t=>t<=periode+1);
    return steps.map(t=>{
      const A_t=STRUCT.A_orig.map((row,i)=>row.map((v,j)=>{
        if(changed[i+"_"+j]){
          const tgt=Amod[i][j]; const delta=tgt-v;
          return v+delta*Math.min(1,t/periode);
        }
        return v;
      }));
      const m=computeStructMetrics(A_t);
      if(!m) return null;
      const qC={I:0,II:0,III:0,IV:0};
      m.BL.forEach((bl,i)=>qC[getQ(bl,m.FL[i]).q]++);
      return {t,BL:m.BL,FL:m.FL,mult:m.mult,qC};
    }).filter(Boolean);
  },[Amod,changed,periode]);

  const W=420,H=360,PAD=44;
  const maxBL=3.2,maxFL=3.6;
  const toX=bl=>PAD+(bl/maxBL)*(W-PAD*2);
  const toY=fl=>PAD+(H-PAD*2)-(fl/maxFL)*(H-PAD*2);
  const refX=toX(1),refY=toY(1);

  const iSty={background:"#0a1628",border:"1px solid #334155",borderRadius:6,
    color:"#f1f5f9",padding:"6px 10px",fontSize:11,width:"100%",boxSizing:"border-box"};

  return (
    <div>
      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#0a1628,#0a1a30)",borderRadius:12,
        padding:"16px 20px",marginBottom:16,borderLeft:"4px solid #0ea5e9"}}>
        <div style={{fontSize:10,color:"#0ea5e9",...mono,letterSpacing:2,marginBottom:6}}>
          ANALISIS STRUKTURAL QUASI-DINAMIS · M@I-2026
        </div>
        <div style={{fontSize:16,fontWeight:700,color:"#f1f5f9",marginBottom:6}}>
          Simulator Perubahan Struktural I-O Rembang 2016
        </div>
        <div style={{fontSize:11,color:"#64748b",lineHeight:1.7}}>
          Modifikasi koefisien teknis A untuk mensimulasikan perubahan struktural jangka panjang —
          lihat bagaimana BL, FL, multiplier, dan kuadran keterkaitan bergeser.
          CGE linier tetap utuh dan tidak diubah.
        </div>
        <div style={{marginTop:10,padding:"8px 12px",background:"#1a0d00",borderRadius:6,
          borderLeft:"2px solid #f59e0b",fontSize:11,color:"#94a3b8"}}>
          <strong style={{color:"#f59e0b"}}>⚠️ Disclaimer quasi-dinamis:</strong>{" "}
          Hasil menggunakan A yang dimodifikasi — bukan data I-O empiris Rembang 2016.
          Gunakan untuk analisis skenario jangka panjang, bukan sebagai fakta empiris.
          Batas modifikasi per koefisien: ±30% dari nilai original.
        </div>
      </div>

      {/* Sub-tab + kontrol */}
      <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap",
        alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {[["editor","🔬 Editor Koefisien A"],["kuadran","🗺️ Pergeseran Kuadran"],
            ["kalkulator","🎯 Kalkulator Target"],["proyeksi","📈 Proyeksi Multi-Periode"]
          ].map(([k,l])=>(
            <Tab key={k} active={subTab===k} onClick={()=>setSubTab(k)}>{l}</Tab>
          ))}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {nChangedCells>0&&(
            <span style={{fontSize:10,color:"#f59e0b",...mono}}>
              {nChangedCells} koefisien diubah
            </span>
          )}
          <button onClick={reset}
            style={{padding:"5px 14px",borderRadius:7,border:"1px solid #334155",
              background:"transparent",color:"#94a3b8",fontSize:11,cursor:"pointer"}}>
            ↺ Reset Original
          </button>
        </div>
      </div>

      {/* ─── EDITOR ─── */}
      {subTab==="editor"&&(
        <div style={{display:"grid",gridTemplateColumns:"220px 1fr",gap:12}}>
          {/* List sektor */}
          <div style={{...card,overflow:"auto",maxHeight:540,padding:"10px 8px"}}>
            <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:8,padding:"0 4px"}}>
              PILIH SEKTOR (baris)
            </div>
            {STRUCT.names.map((nm,i)=>{
              const hasChg=Object.keys(changed).some(k=>changed[k]&&k.startsWith(i+"_"));
              const oQ=getQ(origM.BL[i],origM.FL[i]);
              const nQ=modM?getQ(modM.BL[i],modM.FL[i]):oQ;
              const moved=oQ.q!==nQ.q;
              return (
                <div key={i} onClick={()=>setSelRow(i)}
                  style={{padding:"6px 8px",borderRadius:6,cursor:"pointer",marginBottom:2,
                    background:selRow===i?"#0f2d1a":hasChg?"#1a1000":"transparent",
                    border:selRow===i?"1px solid #22c55e":
                           hasChg?"1px solid #f59e0b44":"1px solid transparent"}}>
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:nQ.color,
                      flexShrink:0,outline:moved?"2px solid "+nQ.color:"none",outlineOffset:2}}/>
                    <span style={{fontSize:10,color:selRow===i?"#f1f5f9":"#94a3b8",
                      fontWeight:selRow===i?600:400,lineHeight:1.3}}>
                      {i+1}. {nm.slice(0,22)}
                    </span>
                  </div>
                  {moved&&(
                    <div style={{fontSize:9,...mono,color:"#f59e0b",marginTop:1,paddingLeft:11}}>
                      {oQ.q}→{nQ.q}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Panel edit koefisien */}
          <div>
            <div style={{...card}}>
              <div style={{display:"flex",justifyContent:"space-between",
                alignItems:"flex-start",marginBottom:12}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:"#f1f5f9",marginBottom:2}}>
                    {selRow+1}. {STRUCT.names[selRow]}
                  </div>
                  <div style={{fontSize:10,color:"#64748b"}}>
                    Edit koefisien a[baris {selRow+1}, kolom j] — proporsi output sektor ini sebagai input sektor j
                  </div>
                </div>
                {modM&&(
                  <div style={{display:"flex",gap:10}}>
                    {[["BL",origM.BL[selRow],modM.BL[selRow],"#f59e0b"],
                      ["FL",origM.FL[selRow],modM.FL[selRow],"#0ea5e9"],
                      ["Mult",origM.mult[selRow],modM.mult[selRow],"#ec4899"]
                    ].map(([l,o,nv,c])=>(
                      <div key={l} style={{textAlign:"center",background:"#0a1628",
                        borderRadius:6,padding:"5px 10px"}}>
                        <div style={{fontSize:9,color:"#64748b",...mono}}>{l}</div>
                        <div style={{fontSize:10,...mono}}>
                          <span style={{color:"#475569"}}>{o.toFixed(3)}</span>
                          <span style={{color:nv>o?"#22c55e":nv<o?"#ef4444":"#64748b",marginLeft:4}}>
                            →{nv.toFixed(3)}
                          </span>
                        </div>
                      </div>
                    ))}
                    <div style={{textAlign:"center",background:"#0a1628",
                      borderRadius:6,padding:"5px 10px"}}>
                      <div style={{fontSize:9,color:"#64748b",...mono}}>Kuadran</div>
                      <div style={{fontSize:10,...mono}}>
                        {(()=>{const o=getQ(origM.BL[selRow],origM.FL[selRow]);
                               const nv=getQ(modM.BL[selRow],modM.FL[selRow]);
                               return <span>
                                 <span style={{color:o.color}}>{o.q}</span>
                                 {o.q!==nv.q&&<span style={{color:nv.color,fontWeight:700}}> →{nv.q}</span>}
                               </span>;
                        })()}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:8}}>
                KOEFISIEN a[{selRow+1}, j] — hanya tampil yang non-nol
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",
                gap:8,maxHeight:360,overflow:"auto"}}>
                {STRUCT.names.map((nm,j)=>{
                  const orig=STRUCT.A_orig[selRow][j];
                  const curr=Amod[selRow][j];
                  const pct=orig>0?(curr-orig)/orig*100:0;
                  const isChg=Math.abs(curr-orig)>0.0001;
                  if (orig<0.0005&&!isChg) return null;
                  return (
                    <div key={j} style={{background:isChg?"#1a1000":"#0a1628",
                      borderRadius:6,padding:"7px 8px",
                      border:isChg?"1px solid #f59e0b44":"1px solid #1e293b"}}>
                      <div style={{fontSize:9,color:"#475569",marginBottom:3,
                        whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                        →{j+1}. {nm.slice(0,14)}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3}}>
                        <input type="range"
                          min={Math.max(0,orig*0.7-0.005).toFixed(4)}
                          max={Math.min(0.99,orig*1.3+0.01).toFixed(4)}
                          step="0.001"
                          value={curr.toFixed(4)}
                          onChange={e=>editA(selRow,j,+e.target.value)}
                          style={{flex:1,accentColor:isChg?"#f59e0b":"#334155"}}/>
                        <span style={{fontSize:9,...mono,
                          color:isChg?"#f59e0b":"#64748b",width:34,textAlign:"right"}}>
                          {curr.toFixed(3)}
                        </span>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:8,...mono}}>
                        <span style={{color:"#334155"}}>orig:{orig.toFixed(3)}</span>
                        {isChg&&<span style={{color:pct>0?"#22c55e":"#ef4444"}}>
                          {pct>0?"+":""}{pct.toFixed(0)}%
                        </span>}
                      </div>
                    </div>
                  );
                }).filter(Boolean)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── PERGESERAN KUADRAN ─── */}
      {subTab==="kuadran"&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:12}}>
          <div style={{...card,padding:10}}>
            <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:6}}>
              PETA KUADRAN — {nChangedCells>0?"ORIGINAL (abu) vs MODIFIKASI (warna)":"A original (belum ada perubahan)"}
            </div>
            <svg viewBox={"0 0 "+W+" "+H} style={{width:"100%",display:"block"}}>
              <rect x={refX} y={PAD}    width={W-PAD-refX} height={refY-PAD}   fill="#22c55e08"/>
              <rect x={PAD}  y={PAD}    width={refX-PAD}   height={refY-PAD}   fill="#0ea5e908"/>
              <rect x={refX} y={refY}   width={W-PAD-refX} height={H-PAD-refY} fill="#f59e0b08"/>
              <rect x={PAD}  y={refY}   width={refX-PAD}   height={H-PAD-refY} fill="#47456808"/>
              {[[(refX+(W-PAD-refX)/2),PAD+10,"I — Kunci","#22c55e"],
                [(PAD+(refX-PAD)/2),PAD+10,"II — Pemimpin","#0ea5e9"],
                [(refX+(W-PAD-refX)/2),H-PAD-5,"III — Pengikut","#f59e0b"],
                [(PAD+(refX-PAD)/2),H-PAD-5,"IV — Independen","#64748b"]
              ].map(([x,y,l,c])=>(
                <text key={l} x={x} y={y} textAnchor="middle" fontSize={8}
                  fill={c} fontWeight="700" fontFamily="Arial" opacity={0.65}>{l}</text>
              ))}
              {[0.5,1.5,2.0,2.5].map(v=>(
                <line key={"vg"+v} x1={toX(v)} y1={PAD} x2={toX(v)} y2={H-PAD}
                  stroke="#1e293b" strokeWidth={0.5} strokeDasharray="2,4"/>
              ))}
              {[0.5,1.5,2.0,2.5,3.0].map(v=>(
                <line key={"hg"+v} x1={PAD} y1={toY(v)} x2={W-PAD} y2={toY(v)}
                  stroke="#1e293b" strokeWidth={0.5} strokeDasharray="2,4"/>
              ))}
              <line x1={refX} y1={PAD} x2={refX} y2={H-PAD}
                stroke="#334155" strokeWidth={1.5} strokeDasharray="5,3"/>
              <line x1={PAD} y1={refY} x2={W-PAD} y2={refY}
                stroke="#334155" strokeWidth={1.5} strokeDasharray="5,3"/>
              {[0,0.5,1,1.5,2,2.5].map(v=>(
                <g key={"tx"+v}>
                  <line x1={toX(v)} y1={H-PAD} x2={toX(v)} y2={H-PAD+4} stroke="#475569"/>
                  <text x={toX(v)} y={H-PAD+12} textAnchor="middle"
                    fontSize={7} fill="#64748b" fontFamily="monospace">{v}</text>
                </g>
              ))}
              {[0,0.5,1,1.5,2,2.5,3].map(v=>(
                <g key={"ty"+v}>
                  <line x1={PAD-3} y1={toY(v)} x2={PAD} y2={toY(v)} stroke="#475569"/>
                  <text x={PAD-6} y={toY(v)+3} textAnchor="end"
                    fontSize={7} fill="#64748b" fontFamily="monospace">{v}</text>
                </g>
              ))}
              <text x={PAD+(W-PAD*2)/2} y={H-2} textAnchor="middle"
                fontSize={9} fill="#94a3b8" fontFamily="Arial">Backward Linkage (BL) →</text>
              <text x={10} y={PAD+(H-PAD*2)/2} textAnchor="middle" fontSize={9}
                fill="#94a3b8" fontFamily="Arial"
                transform={"rotate(-90,10,"+(PAD+(H-PAD*2)/2)+")"}>
                FL →
              </text>
              {STRUCT.names.map((nm,i)=>{
                const oBL=origM.BL[i],oFL=origM.FL[i];
                const nBL=modM?modM.BL[i]:oBL;
                const nFL=modM?modM.FL[i]:oFL;
                const oQ=getQ(oBL,oFL), nQ=getQ(nBL,nFL);
                const moved=oQ.q!==nQ.q;
                const isHov=hovIdx===i;
                return (
                  <g key={i}
                    onMouseEnter={()=>setHovIdx(i)}
                    onMouseLeave={()=>setHovIdx(null)}
                    style={{cursor:"pointer"}}>
                    <circle cx={toX(oBL)} cy={toY(oFL)} r={3.5}
                      fill="#334155" opacity={0.5}/>
                    {moved&&(
                      <line x1={toX(oBL)} y1={toY(oFL)} x2={toX(nBL)} y2={toY(nFL)}
                        stroke="#f59e0b" strokeWidth={1.2} strokeDasharray="3,2" opacity={0.8}/>
                    )}
                    <circle cx={toX(nBL)} cy={toY(nFL)} r={moved?7:4}
                      fill={nQ.color} opacity={0.85}
                      stroke={isHov||moved?"#fff":"transparent"}
                      strokeWidth={isHov||moved?1.5:0}/>
                    {(moved||(nBL>2.0||nFL>2.5))&&(
                      <text x={toX(nBL)+7} y={toY(nFL)+3} fontSize={7}
                        fill={nQ.color} fontFamily="Arial">{i+1}</text>
                    )}
                    {isHov&&(()=>{
                      const tx=toX(nBL)>W*0.68?toX(nBL)-136:toX(nBL)+10;
                      const ty=toY(nFL)<PAD+65?toY(nFL)+8:toY(nFL)-70;
                      return (
                        <g>
                          <rect x={tx} y={ty} width={130} height={66} rx={4}
                            fill="#1e293b" stroke="#334155" strokeWidth={1}/>
                          <text x={tx+6} y={ty+13} fontSize={8} fill="#f8fafc"
                            fontWeight="700" fontFamily="Arial">
                            {i+1}. {nm.slice(0,18)}</text>
                          <text x={tx+6} y={ty+25} fontSize={7} fill="#94a3b8"
                            fontFamily="monospace">
                            BL:{oBL.toFixed(3)}{moved?" →"+nBL.toFixed(3):""}
                          </text>
                          <text x={tx+6} y={ty+36} fontSize={7} fill="#94a3b8"
                            fontFamily="monospace">
                            FL:{oFL.toFixed(3)}{moved?" →"+nFL.toFixed(3):""}
                          </text>
                          <text x={tx+6} y={ty+47} fontSize={7}
                            fill="#94a3b8" fontFamily="monospace">
                            Kuadran:{oQ.q}{moved?" →"+nQ.q:""}
                          </text>
                          <text x={tx+6} y={ty+59} fontSize={7}
                            fill={nQ.color} fontWeight="700" fontFamily="Arial">
                            {nQ.label}
                          </text>
                        </g>
                      );
                    })()}
                  </g>
                );
              })}
            </svg>
            <div style={{display:"flex",gap:12,fontSize:10,color:"#64748b",marginTop:4,flexWrap:"wrap"}}>
              {[["#334155","Posisi original"],["#0ea5e9","Posisi baru (bergeser)"],["#f59e0b dashed","Arah pergeseran"]].map(([c,l])=>(
                <div key={l} style={{display:"flex",alignItems:"center",gap:4}}>
                  <div style={{width:c.includes("dashed")?18:8,height:c.includes("dashed")?0:8,
                    borderRadius:"50%",background:c.includes("dashed")?"transparent":c,
                    border:c.includes("dashed")?"1.5px dashed #f59e0b":"none"}}/>
                  <span>{l}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Ringkasan */}
          <div>
            <div style={{...card,marginBottom:10}}>
              <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:10}}>DISTRIBUSI KUADRAN</div>
              {[["I","Kunci","#22c55e"],["II","Pemimpin","#0ea5e9"],
                ["III","Pengikut","#f59e0b"],["IV","Independen","#64748b"]].map(([q,l,c])=>{
                const o=STRUCT.BL_orig.filter((_,i)=>getQ(origM.BL[i],origM.FL[i]).q===q).length;
                const nv=modM?modM.BL.filter((_,i)=>getQ(modM.BL[i],modM.FL[i]).q===q).length:o;
                return (
                  <div key={q} style={{marginBottom:7,padding:"7px 10px",
                    background:c+"11",borderRadius:6,borderLeft:"2px solid "+c,
                    display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:11,color:c,fontWeight:600}}>{q} — {l}</span>
                    <span style={{fontSize:14,fontWeight:700,color:c,...mono}}>
                      {o}
                      {nv!==o&&<span style={{fontSize:11,color:nv>o?"#22c55e":"#ef4444"}}>
                        {" "}→{nv}
                      </span>}
                    </span>
                  </div>
                );
              })}
              {quadDiff.filter(c=>c.moved).length>0&&(
                <div style={{marginTop:6,padding:"5px 8px",background:"#f59e0b11",
                  borderRadius:5,fontSize:10,color:"#f59e0b",textAlign:"center"}}>
                  ⚡ {quadDiff.filter(c=>c.moved).length} sektor berpindah kuadran
                </div>
              )}
            </div>

            <div style={{...card}}>
              <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:8}}>
                SEKTOR YANG BERPINDAH
              </div>
              {quadDiff.filter(c=>c.moved).length===0?(
                <div style={{fontSize:11,color:"#475569",textAlign:"center",padding:16}}>
                  Belum ada perpindahan kuadran.
                  Edit koefisien A di tab Editor.
                </div>
              ):(
                quadDiff.filter(c=>c.moved).map(c=>(
                  <div key={c.i} style={{marginBottom:8,padding:"7px 10px",
                    background:"#0a1628",borderRadius:6,
                    borderLeft:"2px solid "+c.nQ.color}}>
                    <div style={{fontSize:11,fontWeight:600,color:"#f1f5f9",marginBottom:4}}>
                      {c.i+1}. {c.nm.slice(0,24)}
                    </div>
                    <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:3}}>
                      <span style={{...mono,fontSize:9,padding:"1px 7px",borderRadius:10,
                        background:c.oQ.color+"22",color:c.oQ.color}}>{c.oQ.q}</span>
                      <span style={{color:"#334155"}}>→</span>
                      <span style={{...mono,fontSize:9,padding:"1px 7px",borderRadius:10,
                        background:c.nQ.color+"22",color:c.nQ.color,fontWeight:700}}>
                        {c.nQ.q} {c.nQ.label}
                      </span>
                    </div>
                    <div style={{fontSize:9,...mono,color:"#64748b"}}>
                      ΔBL:{c.dBL>=0?"+":""}{c.dBL.toFixed(3)}{" "}
                      ΔFL:{c.dFL>=0?"+":""}{c.dFL.toFixed(3)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── KALKULATOR TARGET ─── */}
      {subTab==="kalkulator"&&(
        <div style={{...card}}>
          <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:14}}>
            KALKULATOR — STRATEGI MASUK KUADRAN TARGET
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
            <div>
              <div style={{fontSize:11,color:"#64748b",marginBottom:5}}>Sektor yang ingin ditingkatkan</div>
              <select value={selRow} onChange={e=>setSelRow(+e.target.value)} style={{...iSty,marginBottom:12}}>
                {STRUCT.names.map((nm,i)=>(
                  <option key={i} value={i}>{i+1}. {nm.slice(0,30)}</option>
                ))}
              </select>
              <div style={{fontSize:11,color:"#64748b",marginBottom:6}}>Target kuadran</div>
              <div style={{display:"flex",gap:6}}>
                {[["I","#22c55e"],["II","#0ea5e9"],["III","#f59e0b"]].map(([q,c])=>(
                  <button key={q} onClick={()=>setTargetQ(q)}
                    style={{flex:1,padding:"7px",borderRadius:6,border:"none",cursor:"pointer",
                      fontSize:12,fontWeight:700,
                      background:targetQ===q?c+"33":"#1e293b",
                      color:targetQ===q?c:"#64748b"}}>
                    Kuadran {q}
                  </button>
                ))}
              </div>
            </div>

            <div style={{background:"#0a1628",borderRadius:8,padding:"12px 14px"}}>
              {(()=>{
                const bl=origM.BL[selRow], fl=origM.FL[selRow];
                const q=getQ(bl,fl);
                const curQ=q.q;
                const needBL=targetQ==="I"||targetQ==="III";
                const needFL=targetQ==="I"||targetQ==="II";
                const dBL=needBL&&bl<1?+(1.01-bl).toFixed(3):0;
                const dFL=needFL&&fl<1?+(1.01-fl).toFixed(3):0;
                const totOutput=sektor.reduce((a,b)=>a+b.output,0);
                const investEst=Math.round((dBL*origM.mult[selRow]+dFL*origM.mult[selRow]*0.7)
                  *totOutput/n/10);
                const alreadyIn=curQ===targetQ;
                return (
                  <>
                    <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:10}}>
                      STATUS: {STRUCT.names[selRow].slice(0,24).toUpperCase()}
                    </div>
                    {[
                      ["Kuadran saat ini",q.q+" — "+q.label,q.color],
                      ["BL saat ini",bl.toFixed(3)+(bl>1?" ✓":" (perlu ≥1.01 untuk BL>1)"),"#f59e0b"],
                      ["FL saat ini",fl.toFixed(3)+(fl>1?" ✓":" (perlu ≥1.01 untuk FL>1)"),"#0ea5e9"],
                      ["Multiplier",origM.mult[selRow].toFixed(3),"#ec4899"],
                    ].map(([l,v,c])=>(
                      <div key={l} style={{display:"flex",justifyContent:"space-between",
                        padding:"5px 0",borderBottom:"1px solid #1e293b",fontSize:11}}>
                        <span style={{color:"#64748b"}}>{l}</span>
                        <span style={{color:c,fontWeight:600,...mono,textAlign:"right",maxWidth:200}}>
                          {v}
                        </span>
                      </div>
                    ))}
                    <div style={{marginTop:12,padding:"10px 12px",
                      background:alreadyIn?"#0f2d1a":"#1a0d00",borderRadius:8,
                      borderLeft:"2px solid "+(alreadyIn?"#22c55e":"#f59e0b")}}>
                      <div style={{fontSize:10,...mono,
                        color:alreadyIn?"#22c55e":"#f59e0b",marginBottom:6}}>
                        {alreadyIn?"✓ SUDAH DI KUADRAN "+targetQ:
                         "UNTUK MASUK KUADRAN "+targetQ+":"}
                      </div>
                      {!alreadyIn&&(
                        <>
                          {dBL>0&&(
                            <div style={{fontSize:11,color:"#f59e0b",marginBottom:4,lineHeight:1.5}}>
                              → BL perlu naik +{dBL.toFixed(3)}{"\n"}
                              Strategi: perkuat keterkaitan backward —
                              kurangi impor input, gunakan bahan baku lokal lebih banyak.
                            </div>
                          )}
                          {dFL>0&&(
                            <div style={{fontSize:11,color:"#0ea5e9",marginBottom:4,lineHeight:1.5}}>
                              → FL perlu naik +{dFL.toFixed(3)}{"\n"}
                              Strategi: kembangkan industri hilir yang menyerap output sektor ini.
                            </div>
                          )}
                          {dBL===0&&dFL===0&&(
                            <div style={{fontSize:11,color:"#22c55e"}}>
                              Secara teknis sudah memenuhi syarat — pertahankan posisi ini.
                            </div>
                          )}
                          {(dBL>0||dFL>0)&&(
                            <div style={{marginTop:8,padding:"6px 10px",
                              background:"#22c55e11",borderRadius:6,
                              fontSize:12,color:"#22c55e",fontWeight:700}}>
                              Estimasi investasi: Rp {fmt(investEst)} Jt
                              <div style={{fontSize:9,color:"#475569",fontWeight:400,marginTop:2}}>
                                *Estimasi kasar berdasarkan perubahan multiplier yang dibutuhkan
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          <div style={{background:"#0a1628",borderRadius:8,padding:"10px 14px",
            fontSize:11,color:"#94a3b8",lineHeight:1.7}}>
            <strong style={{color:"#f1f5f9"}}>Panduan praktis:</strong>{" "}
            Untuk naik ke Kuadran I (kunci), sektor butuh BL &gt; 1 DAN FL &gt; 1.
            Kuadran II (FL&gt;1) lebih mudah dicapai dengan membangun industri hilir.
            Kuadran III (BL&gt;1) lebih mudah dicapai dengan mengurangi impor input dan
            menggantinya dengan bahan baku lokal. Gunakan tab Editor Koefisien A untuk
            mensimulasikan perubahan tersebut secara interaktif.
          </div>
        </div>
      )}

      {/* ─── PROYEKSI MULTI-PERIODE ─── */}
      {subTab==="proyeksi"&&(
        <div>
          <div style={{...card,marginBottom:12}}>
            <div style={{display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
              <div style={{flex:1}}>
                <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:4}}>
                  HORIZON PROYEKSI
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <input type="range" min={1} max={15} step={1} value={periode}
                    onChange={e=>setPeriode(+e.target.value)}
                    style={{flex:1,accentColor:"#0ea5e9"}}/>
                  <span style={{fontSize:16,fontWeight:700,color:"#0ea5e9",...mono,width:42}}>
                    t+{periode}
                  </span>
                </div>
              </div>
              <div style={{display:"flex",gap:6}}>
                {[["Lambat (10 th)",10],["Sedang (5 th)",5],["Cepat (3 th)",3]].map(([l,v])=>(
                  <button key={l} onClick={()=>setPeriode(v)}
                    style={{padding:"5px 10px",borderRadius:6,border:"none",cursor:"pointer",
                      fontSize:10,fontWeight:600,
                      background:periode===v?"#0ea5e933":"#1e293b",
                      color:periode===v?"#0ea5e9":"#64748b"}}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {periodeSteps.length>1?(
            <>
              <div style={{...card,marginBottom:12}}>
                <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:10}}>
                  DISTRIBUSI KUADRAN PER PERIODE
                </div>
                <div style={{display:"flex",gap:4,alignItems:"flex-end",height:140,
                  background:"#0a1628",borderRadius:8,padding:"10px 8px"}}>
                  {periodeSteps.map((pd,pi)=>(
                    <div key={pi} style={{flex:1,display:"flex",flexDirection:"column",
                      alignItems:"center",minWidth:30}}>
                      {[["I","#22c55e"],["II","#0ea5e9"],["III","#f59e0b"],["IV","#64748b"]].map(([q,c])=>(
                        <div key={q} style={{
                          width:"85%",
                          height:((pd.qC[q]||0)/n*100)+"px",
                          background:c,opacity:0.8,transition:"height 0.4s"
                        }}/>
                      ))}
                      <div style={{fontSize:8,...mono,color:"#475569",marginTop:4,textAlign:"center"}}>
                        {pd.t===0?"now":"t+"+pd.t}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{display:"flex",gap:12,marginTop:6,fontSize:10,color:"#64748b",flexWrap:"wrap"}}>
                  {[["I","#22c55e","Kunci"],["II","#0ea5e9","Pemimpin"],
                    ["III","#f59e0b","Pengikut"],["IV","#64748b","Independen"]].map(([q,c,l])=>(
                    <div key={q} style={{display:"flex",alignItems:"center",gap:4}}>
                      <div style={{width:10,height:10,background:c,borderRadius:2}}/>
                      <span>{q}:{l}</span>
                    </div>
                  ))}
                </div>
              </div>

              {quadDiff.filter(c=>c.moved).length>0?(
                <div style={{...card}}>
                  <div style={{fontSize:10,color:"#64748b",...mono,marginBottom:10}}>
                    TRAJEKTORI PERPINDAHAN KUADRAN
                  </div>
                  <div style={{overflow:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                      <thead><tr style={{background:"#1e293b"}}>
                        <th style={{padding:"7px 10px",textAlign:"left",
                          color:"#64748b",...mono,fontSize:10,borderBottom:"1px solid #334155",
                          minWidth:140}}>Sektor</th>
                        {periodeSteps.map(pd=>(
                          <th key={pd.t} style={{padding:"7px 8px",textAlign:"center",
                            color:"#64748b",...mono,fontSize:9,borderBottom:"1px solid #334155",minWidth:44}}>
                            {pd.t===0?"now":"t+"+pd.t}
                          </th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {quadDiff.filter(c=>c.moved).map(sc=>(
                          <tr key={sc.i} style={{borderBottom:"1px solid #0f172a"}}>
                            <td style={{padding:"6px 10px",color:"#e2e8f0",fontSize:10}}>
                              {sc.i+1}. {sc.nm.slice(0,22)}
                            </td>
                            {periodeSteps.map(pd=>{
                              const q=getQ(pd.BL[sc.i],pd.FL[sc.i]);
                              return (
                                <td key={pd.t} style={{padding:"6px 8px",textAlign:"center"}}>
                                  <span style={{padding:"2px 7px",borderRadius:10,fontSize:9,
                                    fontWeight:700,background:q.color+"22",color:q.color,...mono}}>
                                    {q.q}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ):(
                <div style={{...card,textAlign:"center",color:"#475569",padding:30}}>
                  Edit koefisien A di tab Editor terlebih dahulu untuk melihat trajektori proyeksi.
                </div>
              )}
            </>
          ):(
            <div style={{...card,textAlign:"center",color:"#475569",padding:30,fontSize:12}}>
              Edit koefisien A di tab Editor untuk mengaktifkan proyeksi multi-periode.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PanduanCara() {
  const [sub, setSub] = useState("lokal");
  return (
    <div>
      <Sec title="🚀 Cara Menjalankan Platform CGE Indonesia" accent="#22c55e"
        sub="Pilih metode yang sesuai dengan kebutuhan Anda — dari menjalankan lokal di laptop hingga deploy ke server.">
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {[["lokal","💻 Lokal (Laptop)"],["online","🌐 Online (Claude.ai)"],["server","🖥️ Deploy Server"],["data","📂 Persiapan Data"]].map(([k,l])=>(
            <Chip key={k} active={sub===k} onClick={()=>setSub(k)}>{l}</Chip>
          ))}
        </div>

        {sub === "lokal" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#22c55e", marginBottom: 12 }}>Metode 1 — Vite + React (Direkomendasikan)</div>
              {[
                ["Prasyarat", "Node.js v18+ dan npm (download dari nodejs.org)"],
                ["1. Buat project", "npm create vite@latest cge-rembang -- --template react"],
                ["2. Masuk folder", "cd cge-rembang"],
                ["3. Install deps", "npm install recharts"],
                ["4. Copy file", "Copy file platform_cge_indonesia_v2.jsx ke src/App.jsx"],
                ["5. Jalankan", "npm run dev"],
                ["6. Buka browser", "Otomatis terbuka di http://localhost:5173"],
              ].map(([k, v]) => (
                <div key={k} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: "#64748b", ...mono, marginBottom: 3 }}>{k}</div>
                  <div style={{ background: "#0a1628", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#22c55e", ...mono }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0ea5e9", marginBottom: 12 }}>Metode 2 — CodeSandbox (Tanpa Install)</div>
              {[
                ["Langkah 1", "Buka codesandbox.io → klik 'Create Sandbox'"],
                ["Langkah 2", "Pilih template 'React'"],
                ["Langkah 3", "Hapus konten App.js, paste seluruh kode JSX"],
                ["Langkah 4", "Di terminal CodeSandbox: npm install recharts"],
                ["Langkah 5", "Klik tombol 'Refresh' di preview panel"],
                ["Langkah 6", "Platform langsung berjalan di browser!"],
                ["Tips", "Klik 'Share' untuk bagikan link ke rekan kerja"],
              ].map(([k, v]) => (
                <div key={k} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: "#64748b", ...mono, marginBottom: 3 }}>{k}</div>
                  <div style={{ background: "#0a1628", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#0ea5e9", ...mono }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {sub === "online" && (
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b", marginBottom: 12 }}>Menjalankan di Claude.ai (Paling Mudah — Seperti Sekarang!)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div>
                <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.8, marginBottom: 12 }}>
                  Platform ini sudah berjalan langsung di Claude.ai sebagai <strong style={{ color: "#f8fafc" }}>React Artifact</strong>.
                  Tidak perlu install apapun — semua langsung di browser.
                </div>
                {[
                  "Buka claude.ai dan mulai percakapan baru",
                  "Upload file .jsx ini sebagai attachment",
                  "Atau: minta Claude untuk menampilkan ulang artifact",
                  "Platform langsung interaktif di panel kanan",
                  "Dapat di-expand ke full screen dengan klik ikon expand",
                ].map((s, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#f59e0b", color: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>{s}</div>
                  </div>
                ))}
              </div>
              <div style={{ background: "#0a1628", borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 11, color: "#f59e0b", ...mono, marginBottom: 8 }}>KEUNTUNGAN CLAUDE.AI</div>
                {[
                  ["✅ Tanpa instalasi", "Langsung berjalan"],
                  ["✅ Auto-save", "Artifact tersimpan di history"],
                  ["✅ Share mudah", "Link percakapan bisa dibagikan"],
                  ["✅ Iterasi cepat", "Minta modifikasi langsung ke Claude"],
                  ["⚠️ Data tidak persist", "Data reset saat refresh halaman"],
                  ["⚠️ Ukuran terbatas", "File besar mungkin perlu dipotong"],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #1e293b", fontSize: 11 }}>
                    <span style={{ color: "#e2e8f0" }}>{k}</span>
                    <span style={{ color: "#64748b" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {sub === "server" && (
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#8b5cf6", marginBottom: 12 }}>Deploy ke Server / VPS (Untuk Penggunaan Institusi)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: "#64748b", ...mono, marginBottom: 8 }}>BUILD & DEPLOY (Vercel/Netlify — Gratis)</div>
                {["npm run build", "# Upload folder 'dist/' ke Vercel", "# Atau drag-drop ke netlify.com/drop", "# URL publik langsung tersedia"].map((c, i) => (
                  <div key={i} style={{ background: "#0a1628", borderRadius: 4, padding: "6px 10px", marginBottom: 4, fontSize: 11, color: "#8b5cf6", ...mono }}>{c}</div>
                ))}
                <div style={{ fontSize: 11, color: "#64748b", ...mono, margin: "12px 0 8px" }}>SELF-HOSTED (Nginx)</div>
                {["npm run build", "cp -r dist/ /var/www/cge-platform/", "# Konfig nginx → serve folder dist", "# Akses via IP server atau domain"].map((c, i) => (
                  <div key={i} style={{ background: "#0a1628", borderRadius: 4, padding: "6px 10px", marginBottom: 4, fontSize: 11, color: "#8b5cf6", ...mono }}>{c}</div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#64748b", ...mono, marginBottom: 8 }}>SPESIFIKASI MINIMUM SERVER</div>
                {[["CPU","1 vCPU (static site, ringan)"],["RAM","512 MB cukup"],["Storage","500 MB (termasuk node_modules)"],["Node.js","v18 LTS"],["OS","Ubuntu 20.04+ / CentOS 8+"]].map(([k,v])=>(
                  <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:"1px solid #1e293b", fontSize:11 }}>
                    <span style={{color:"#94a3b8"}}>{k}</span><span style={{color:"#8b5cf6",...mono}}>{v}</span>
                  </div>
                ))}
                <div style={{ marginTop: 12, padding: "10px 12px", background: "#8b5cf615", borderRadius: 8, fontSize: 11, color: "#94a3b8", lineHeight: 1.6, borderLeft: "2px solid #8b5cf6" }}>
                  💡 Untuk penggunaan di Bappeda/Dinas, deploy ke server internal agar data APBD sensitif tidak keluar ke layanan publik.
                </div>
              </div>
            </div>
          </div>
        )}

        {sub === "data" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {[
              { title: "📊 Data PDRB", color: "#22c55e", items: [
                "BPS Kabupaten → Publikasi PDRB Menurut Lapangan Usaha",
                "Ambil data ADHB (Atas Dasar Harga Berlaku) tahun terkini",
                "Download tabel PDRB 17 kategori + subkategori",
                "Format: Excel/PDF dari website BPS kab/kota",
                "URL: [kodekab].bps.go.id → Produksi → PDRB",
              ]},
              { title: "🏛️ Data APBD", color: "#0ea5e9", items: [
                "Dari DJPK (djpk.kemenkeu.go.id) → Download APBD",
                "Atau dari website Bappeda kabupaten setempat",
                "Komponen: belanja pegawai, barang/jasa, modal",
                "Komponen: retribusi, pajak daerah, DAU/DAK",
                "Tahun data sesuaikan dengan tahun I-O referensi",
              ]},
              { title: "👥 Data Sakernas", color: "#f59e0b", items: [
                "Publikasi Profil Ketenagakerjaan dari BPS Kab",
                "Atau akses langsung: www.bps.go.id → Sosial → Ketenagakerjaan",
                "Data: TPAK, TPT, distribusi lapangan kerja",
                "Data: distribusi pendidikan pekerja, status pekerjaan",
                "Periode: Agustus tahun terkini (lebih lengkap dari Februari)",
              ]},
              { title: "📋 Tabel I-O Referensi", color: "#f97316", items: [
                "Pilih kabupaten tetangga yang strukturnya mirip",
                "Cek publikasi I-O di website BPS provinsi",
                "Atau gunakan I-O 52 sektor Provinsi Jawa Tengah (BPS)",
                "Format: Excel dengan sheet transaksi domestik ADHP",
                "Jika tidak ada: gunakan template dari Platform ini",
              ]},
            ].map(({ title, color, items }) => (
              <div key={title} style={{ ...card, borderTop: `2px solid ${color}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 10 }}>{title}</div>
                {items.map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                    <span style={{ color, fontSize: 10, marginTop: 2, flexShrink: 0 }}>▸</span>
                    <span style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>{item}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Sec>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function App() {
  const [mode, setMode]         = useState("home");
  const [tab, setTab]           = useState("overview");
  const [wStep, setWStep]       = useState(1);
  const [wData, setWData]       = useState({});
  const [dList, setDList]       = useState([REMBANG]);
  const [curD, setCurD]         = useState(REMBANG.nama);
  const [si, setSi]             = useState(15);
  const [amt, setAmt]           = useState(500000);
  const [stype, setStype]       = useState("investasi");
  const [fGrp, setFGrp]         = useState("Semua");
  const [cgeSubTab, setCgeSubTab] = useState("simulasi");
  const [cgeParams, setCgeParams] = useState({sigmaArm:2.0, sigmaCet:2.5, mpc:0.68});
  const [subTabIO, setSubTabIO]   = useState("ringkasan");
  const [dlMsg, setDlMsg]       = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [previewHTML, setPreviewHTML] = useState("");

  const D      = dList.find(d => d.nama === curD) || REMBANG;
  const sektor = D.sektor || [];
  const makro  = D.makro  || {};
  const tk     = D.tk     || {};
  const SAM    = D.SAM    || {};

  const cge = useMemo(() => runCGE(sektor, makro, si, amt, stype), [sektor, makro, si, amt, stype]);

  const showMsg = (msg) => { setDlMsg(msg); setTimeout(()=>setDlMsg(""),2800); };
  const dlIO      = () => { downloadBlob(sektor2CSV(sektor,D.nama,D.tahun), `IO_${D.nama.replace(/\s/g,"_")}_${D.tahun}.csv`); showMsg("✅ File I-O didownload!"); };
  const dlSAM     = () => { downloadBlob(sam2CSV(SAM,D.nama,D.tahun), `SAM_${D.nama.replace(/\s/g,"_")}_${D.tahun}.csv`); showMsg("✅ File SAM didownload!"); };
  const dlLinkage = () => { downloadBlob(linkage2CSV(sektor,D.nama,D.tahun), `Keterkaitan_${D.nama.replace(/\s/g,"_")}_${D.tahun}.csv`); showMsg("✅ File Keterkaitan didownload!"); };
  const dlLaporan = () => {
    try {
      const html = generateLaporanHTML(D, cge, stype, amt);
      setPreviewHTML(html);
      setShowPreview(true);
    } catch(err) {
      console.error("Error generate laporan:", err);
      showMsg("❌ Error: " + err.message);
    }
  };

  const grps   = ["Semua", ...Object.keys(GRP)];
  const fSek   = fGrp === "Semua" ? sektor : sektor.filter(s => s.grp === fGrp);

  const generateDaerah = useCallback(() => {
    const scale = (wData.PDRB || REMBANG.makro.PDRB) / REMBANG.makro.PDRB;
    const nd = {
      nama: wData.nama || "Daerah Baru",
      provinsi: wData.provinsi || "",
      tahun: +wData.tahun || 2016,
      io_ref: `${wData.io_ref||"Template RAS"} — Skalasi dari Rembang`,
      sektor: REMBANG.sektor.map(s => ({
        ...s,
        output: Math.round(s.output * scale),
        ntb: Math.round(s.ntb * scale),
        upah: Math.round(s.upah * scale),
      })),
      makro: {
        PDRB: +wData.PDRB || REMBANG.makro.PDRB * scale,
        C_rt: +wData.C_rt || REMBANG.makro.C_rt * scale,
        G_gov: +wData.G_gov || REMBANG.makro.G_gov * scale,
        I_pmtb: +wData.I_pmtb || REMBANG.makro.I_pmtb * scale,
        ekspor: +wData.ekspor || REMBANG.makro.ekspor * scale,
        impor: +wData.impor || REMBANG.makro.impor * scale,
        ntb: REMBANG.makro.ntb * scale,
        upah: REMBANG.makro.upah * scale,
        surplus: REMBANG.makro.surplus * scale,
      },
      SAM: REMBANG.SAM,
      tk: {
        ...REMBANG.tk,
        puk: +wData.puk || Math.round(REMBANG.tk.puk * scale),
        angkatan: +wData.ak || Math.round(REMBANG.tk.angkatan * scale),
        bekerja: +wData.bekerja || Math.round(REMBANG.tk.bekerja * scale),
        tpak: +wData.tpak || REMBANG.tk.tpak,
        tpt: +wData.tpt || REMBANG.tk.tpt,
        formal: +wData.formal || REMBANG.tk.formal,
        informal: 100 - (+wData.formal || REMBANG.tk.formal),
      }
    };
    setDList(p => [...p.filter(d => d.nama !== nd.nama), nd]);
    setCurD(nd.nama);
    setMode("analysis");
    setTab("overview");
    setWStep(1); setWData({});
  }, [wData]);

  const TABS = [
    ["overview","🏠 Overview"],["io","📊 I-O"],["sam","🏛️ SAM"],
    ["linkage","🔗 Keterkaitan"],["cge","⚡ CGE & Simulasi"],
    ["tenaga","👥 Tenaga Kerja"],["metodologi","📚 Metodologi"],
    ["analisis","📋 Contoh Analisis"],
    ["struktural","🔬 Analisis Struktural"],
    ["panduan","📖 Cara Pakai"],
  ];

  // ── HOME ──────────────────────────────────
  if (mode === "home") return (
    <div style={{ minHeight:"100vh", background:"#020817", color:"#e2e8f0", fontFamily:"'DM Sans',system-ui,sans-serif" }}>
      <div style={{ background:"linear-gradient(135deg,#020817,#0a1628 50%,#020817)", padding:"56px 40px 48px", textAlign:"center", borderBottom:"1px solid #1e293b" }}>
        <div style={{ fontSize:11,...mono,color:"#22c55e",letterSpacing:3,marginBottom:14 }}>PLATFORM ANALISIS EKONOMI REGIONAL · INDONESIA</div>
        <h1 style={{ fontSize:40,fontWeight:900,margin:"0 0 14px",background:"linear-gradient(135deg,#f8fafc,#94a3b8)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent" }}>Platform CGE Indonesia</h1>
        <p style={{ fontSize:15,color:"#64748b",maxWidth:560,margin:"0 auto 28px",lineHeight:1.7 }}>
          Computable General Equilibrium untuk kabupaten/kota yang belum memiliki tabel I-O sendiri. Input data BPS → regionalisasi RAS otomatis → SAM → simulasi dampak kebijakan.
        </p>
        <div style={{fontSize:11,color:"#334155",...mono,letterSpacing:2,marginBottom:4}}>
          developed by <span style={{color:"#22c55e",fontWeight:700,fontSize:13}}>M@I-2026</span>
        </div>
        <div style={{ display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap" }}>
          <button onClick={()=>{setCurD(REMBANG.nama);setMode("analysis");setTab("overview")}} style={{ padding:"12px 26px",borderRadius:10,border:"none",background:"#22c55e",color:"#0f172a",fontSize:13,fontWeight:700,cursor:"pointer" }}>📊 Demo: Kab. Rembang</button>
          <button onClick={()=>setMode("wizard")} style={{ padding:"12px 26px",borderRadius:10,border:"1px solid #334155",background:"transparent",color:"#94a3b8",fontSize:13,cursor:"pointer" }}>➕ Tambah Daerah Baru</button>
          <button onClick={()=>{setCurD(REMBANG.nama);setMode("analysis");setTab("panduan")}} style={{ padding:"12px 26px",borderRadius:10,border:"1px solid #22c55e33",background:"#22c55e10",color:"#22c55e",fontSize:13,cursor:"pointer" }}>📖 Cara Menjalankan</button>
        </div>
      </div>
      <div style={{ maxWidth:1000,margin:"36px auto",padding:"0 24px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:14 }}>
        {[
          ["🗺️","Tanpa I-O Lokal","Regionalisasi RAS otomatis dari I-O kabupaten terdekat","#22c55e"],
          ["⚡","Simulasi CGE","Hitung dampak investasi, subsidi, ekspor terhadap output & pendapatan","#0ea5e9"],
          ["🔀","Transmisi Dampak","Visualisasi alur: shock → input antara → upah → konsumsi → GDP","#f59e0b"],
          ["🔗","Analisis Keterkaitan","Diagram kuadran BL×FL, identifikasi sektor kunci pembangunan","#f97316"],
          ["🏛️","Konstruksi SAM","Social Accounting Matrix 7×7 dari PDRB + APBD + Sakernas","#8b5cf6"],
          ["🔄","Multi-Daerah","Tambah dan bandingkan analisis berbagai kabupaten/kota","#ec4899"],
        ].map(([i,t,d,c])=>(
          <div key={t} style={{ ...card, borderTop:`2px solid ${c}` }}>
            <div style={{ fontSize:26,marginBottom:8 }}>{i}</div>
            <div style={{ fontSize:13,fontWeight:700,color:"#f1f5f9",marginBottom:6 }}>{t}</div>
            <div style={{ fontSize:11,color:"#64748b",lineHeight:1.6 }}>{d}</div>
          </div>
        ))}
      </div>
      <div style={{ maxWidth:1000,margin:"0 auto 40px",padding:"0 24px" }}>
        <div style={{ fontSize:13,fontWeight:700,color:"#f1f5f9",marginBottom:12 }}>Daerah Tersedia</div>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10 }}>
          {dList.map(d=>(
            <div key={d.nama} onClick={()=>{setCurD(d.nama);setMode("analysis")}} style={{ ...card,cursor:"pointer",borderColor:curD===d.nama?"#22c55e":"#1e293b" }}>
              <div style={{ fontSize:13,fontWeight:700,color:"#f1f5f9" }}>{d.nama}</div>
              <div style={{ fontSize:10,color:"#64748b",marginBottom:8 }}>{d.provinsi} · {d.tahun}</div>
              <div style={{ display:"flex",gap:14 }}>
                <div><div style={{ fontSize:9,color:"#475569" }}>PDRB</div><div style={{ fontSize:12,color:"#22c55e",...mono }}>Rp {((d.makro?.PDRB||0)/1000).toFixed(1)} M</div></div>
                <div><div style={{ fontSize:9,color:"#475569" }}>Sektor</div><div style={{ fontSize:12,color:"#0ea5e9",...mono }}>{d.sektor?.length||0}</div></div>
              </div>
            </div>
          ))}
          <div onClick={()=>setMode("wizard")} style={{ ...card,cursor:"pointer",border:"1px dashed #334155",display:"flex",alignItems:"center",justifyContent:"center",gap:8,color:"#334155",minHeight:80 }}>
            <span style={{ fontSize:24 }}>➕</span><span style={{ fontSize:12 }}>Tambah Daerah</span>
          </div>
        </div>
      </div>
    </div>
  );

  // ── WIZARD ──────────────────────────────────
  if (mode === "wizard") {
    const step = WIZARD_STEPS[wStep - 1];
    return (
      <div style={{ minHeight:"100vh",background:"#020817",color:"#e2e8f0",fontFamily:"'DM Sans',system-ui,sans-serif",padding:"32px 24px" }}>
        <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:28 }}>
          <button onClick={()=>setMode("home")} style={{ padding:"5px 12px",borderRadius:6,border:"1px solid #334155",background:"transparent",color:"#94a3b8",cursor:"pointer",fontSize:11 }}>← Beranda</button>
          <span style={{ fontSize:15,fontWeight:700,color:"#f1f5f9" }}>Wizard Tambah Daerah Baru</span>
        </div>
        <div style={{ maxWidth:680,margin:"0 auto" }}>
          <div style={{ display:"flex",gap:3,marginBottom:22 }}>
            {WIZARD_STEPS.map((_,i)=><div key={i} style={{ flex:1,height:3,borderRadius:2,background:i<wStep?"#22c55e":"#1e293b",transition:"background 0.3s" }}/>)}
          </div>
          <div style={card}>
            <div style={{ fontSize:10,color:"#22c55e",...mono,marginBottom:6 }}>LANGKAH {wStep}/{WIZARD_STEPS.length}</div>
            <h3 style={{ margin:"0 0 18px",fontSize:15,color:"#f1f5f9" }}>{step.title}</h3>
            {wStep===5&&<div style={{ background:"#22c55e15",border:"1px solid #22c55e30",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:11,color:"#94a3b8",lineHeight:1.7 }}>
              ℹ️ Platform akan menjalankan algoritma RAS biproportional scaling menggunakan PDRB daerah sebagai data kontrol, kemudian menghitung matriks Leontief, SAM, dan semua multiplier secara otomatis.
            </div>}
            <div style={{ display:"grid",gridTemplateColumns:wStep===2?"1fr 1fr":"1fr",gap:"0 18px" }}>
              {step.fields.map(f => (
                <div key={f.k} style={{ marginBottom:12 }}>
                  <label style={{ fontSize:11,color:"#94a3b8",display:"block",marginBottom:4 }}>{f.l}</label>
                  {f.t==="select"?(
                    <select value={wData[f.k]||""} onChange={e=>setWData(p=>({...p,[f.k]:e.target.value}))}
                      style={{ width:"100%",background:"#0a1628",border:"1px solid #334155",borderRadius:8,color:"#f1f5f9",padding:"9px 12px",fontSize:12 }}>
                      <option value="">-- Pilih --</option>
                      {f.opts.map(o=><option key={o} value={o}>{o}</option>)}
                    </select>
                  ):(
                    <input type={f.t} value={wData[f.k]||""} placeholder={f.ph||""}
                      onChange={e=>setWData(p=>({...p,[f.k]:f.t==="number"?+e.target.value:e.target.value}))}
                      style={{ width:"100%",background:"#0a1628",border:"1px solid #334155",borderRadius:8,color:"#f1f5f9",padding:"9px 12px",fontSize:12,boxSizing:"border-box" }}/>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display:"flex",gap:10,justifyContent:"flex-end",marginTop:12 }}>
            {wStep>1&&<button onClick={()=>setWStep(s=>s-1)} style={{ padding:"9px 20px",borderRadius:8,border:"1px solid #334155",background:"transparent",color:"#94a3b8",cursor:"pointer",fontSize:12 }}>← Kembali</button>}
            <button onClick={wStep<WIZARD_STEPS.length?()=>setWStep(s=>s+1):generateDaerah}
              style={{ padding:"9px 24px",borderRadius:8,border:"none",background:"#22c55e",color:"#0f172a",cursor:"pointer",fontSize:12,fontWeight:700 }}>
              {wStep===WIZARD_STEPS.length?"🚀 Generate Analisis":"Lanjut →"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── ANALYSIS ────────────────────────────────
  return (
    <div style={{ minHeight:"100vh",background:"#020817",color:"#e2e8f0",fontFamily:"'DM Sans',system-ui,sans-serif" }}>
      {/* Topbar */}
      <div style={{ background:"#0a1628",borderBottom:"1px solid #1e293b",padding:"10px 20px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap" }}>
        <button onClick={()=>setMode("home")} style={{ padding:"4px 10px",borderRadius:5,border:"1px solid #334155",background:"transparent",color:"#94a3b8",cursor:"pointer",fontSize:10 }}>← Home</button>
        <div style={{ flex:1,fontSize:13,fontWeight:700,color:"#f1f5f9" }}>{D.nama}<span style={{ fontSize:10,color:"#475569",marginLeft:8 }}>{D.provinsi} · {D.tahun} · {D.io_ref}</span></div>
        <select value={curD} onChange={e=>setCurD(e.target.value)} style={{ background:"#1e293b",border:"1px solid #334155",borderRadius:6,color:"#94a3b8",padding:"4px 8px",fontSize:11 }}>
          {dList.map(d=><option key={d.nama} value={d.nama}>{d.nama}</option>)}
        </select>
        <button onClick={()=>setMode("wizard")} style={{ padding:"4px 10px",borderRadius:5,border:"none",background:"#22c55e20",color:"#22c55e",cursor:"pointer",fontSize:10,fontWeight:700 }}>➕ Tambah</button>
        <button onClick={dlLaporan} style={{ padding:"4px 10px",borderRadius:5,border:"none",background:"#f97316",color:"#fff",cursor:"pointer",fontSize:10,fontWeight:700 }}>📄 Buka Laporan</button>
        {dlMsg&&<span style={{ fontSize:11,color:"#22c55e",background:"#0f2d1a",padding:"4px 10px",borderRadius:5,fontWeight:600 }}>{dlMsg}</span>}
      </div>
      {/* Tabs */}
      <div style={{ background:"#0a1628",borderBottom:"1px solid #1e293b",padding:"8px 20px",display:"flex",gap:6,overflowX:"auto" }}>
        {TABS.map(([k,l])=><Tab key={k} active={tab===k} onClick={()=>setTab(k)}>{l}</Tab>)}
      </div>
      <div style={{ padding:"20px",maxWidth:1400,margin:"0 auto" }}>

        {/* OVERVIEW */}
        {tab==="overview"&&<div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginBottom:18 }}>
            <KPI label="PDRB Total" value={`${(makro.PDRB/1e6).toFixed(2)}`} unit="T Rp" color="#22c55e" icon="💰"/>
            <KPI label="NTB / Value Added" value={`${(makro.ntb/1e6).toFixed(2)}`} unit="T Rp" color="#0ea5e9" icon="📈"/>
            <KPI label="Angkatan Kerja" value={fmt(tk.angkatan)} unit="org" color="#f59e0b" icon="👷"/>
            <KPI label="TPAK" value={tk.tpak} unit="%" color="#f97316" icon="📊"/>
            <KPI label="TPT" value={tk.tpt} unit="%" color="#ef4444" icon="⚠️"/>
            <KPI label="Rasio Ekspor" value={`${((makro.ekspor/makro.PDRB)*100).toFixed(1)}`} unit="%" color="#8b5cf6" icon="🚀"/>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14 }}>
            <div style={card}>
              <div style={{ fontSize:10,color:"#64748b",...mono,marginBottom:10 }}>PDRB SEKTORAL (JUTA RP)</div>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart><Pie data={[
                  {name:"Pertanian+Perikanan",value:sektor.filter(s=>["Pertanian","Perikanan"].includes(s.grp)).reduce((a,b)=>a+b.output,0)},
                  {name:"Pertambangan",value:sektor.filter(s=>s.grp==="Pertambangan").reduce((a,b)=>a+b.output,0)},
                  {name:"Industri",value:sektor.filter(s=>s.grp==="Industri").reduce((a,b)=>a+b.output,0)},
                  {name:"Konstruksi",value:sektor.filter(s=>s.grp==="Konstruksi").reduce((a,b)=>a+b.output,0)},
                  {name:"Jasa+Utilitas",value:sektor.filter(s=>["Jasa","Utilitas"].includes(s.grp)).reduce((a,b)=>a+b.output,0)},
                ]} cx="50%" cy="50%" outerRadius={90} innerRadius={48} dataKey="value" paddingAngle={2}>
                  {PAL.map((c,i)=><Cell key={i} fill={c}/>)}</Pie>
                  <Tooltip formatter={v=>`Rp ${fmt(v,0)} Jt`} contentStyle={{ background:"#1e293b",border:"1px solid #334155",borderRadius:8,fontSize:11 }}/>
                  <Legend iconSize={9} wrapperStyle={{ fontSize:10,color:"#94a3b8" }}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={card}>
              <div style={{ fontSize:10,color:"#64748b",...mono,marginBottom:10 }}>TOP 8 OUTPUT SEKTORAL</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={[...sektor].sort((a,b)=>b.output-a.output).slice(0,8).map(s=>({nama:s.nama.slice(0,14),output:s.output,grp:s.grp}))} margin={{ bottom:40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                  <XAxis dataKey="nama" tick={{ fontSize:8,fill:"#94a3b8" }} angle={-35} textAnchor="end"/>
                  <YAxis tickFormatter={v=>fmtT(v)} tick={{ fontSize:9,fill:"#64748b" }}/>
                  <Tooltip formatter={v=>`Rp ${fmt(v,0)} Jt`} contentStyle={{ background:"#1e293b",border:"1px solid #334155",borderRadius:8,fontSize:11 }}/>
                  <Bar dataKey="output" radius={[4,4,0,0]}>
                    {[...sektor].sort((a,b)=>b.output-a.output).slice(0,8).map((s,i)=><Cell key={i} fill={GRP[s.grp]||"#22c55e"}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>}

        {/* IO */}
        {tab==="io"&&<div>
          {/* Sub-tab I-O */}
          <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{display:"flex",gap:6}}>
              {[["ringkasan","📋 Ringkasan Sektoral"],["matriks_z","📊 Matriks Transaksi (Z)"],["matriks_a","📐 Koefisien Teknis (A)"]].map(([k,l])=>(
                <Tab key={k} active={(subTabIO||"ringkasan")===k} onClick={()=>setSubTabIO(k)}>{l}</Tab>
              ))}
            </div>
          </div>

          {(subTabIO||"ringkasan")==="ringkasan"&&(
            <Sec title="Ringkasan Tabel I-O Regional (Hasil Regionalisasi RAS)" accent="#0ea5e9"
              sub="Output, NTB, upah, dan multiplier per sektor hasil regionalisasi RAS dari I-O referensi.">
              <div style={{display:"flex",gap:7,marginBottom:12,flexWrap:"wrap",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  {grps.map(g=><Chip key={g} active={fGrp===g} onClick={()=>setFGrp(g)} color={GRP[g]||"#22c55e"}>{g}</Chip>)}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={dlIO} style={{padding:"5px 14px",borderRadius:7,border:"none",background:"#0ea5e9",color:"#fff",cursor:"pointer",fontSize:11,fontWeight:700}}>⬇ Download I-O (.csv)</button>
                  <button onClick={dlLinkage} style={{padding:"5px 14px",borderRadius:7,border:"none",background:"#f59e0b",color:"#0f172a",cursor:"pointer",fontSize:11,fontWeight:700}}>⬇ Download Keterkaitan</button>
                </div>
              </div>
              <SankeyIO sektor={sektor}/>
              <div style={{...card,overflow:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead><tr style={{background:"#1e293b"}}>
                    {["#","Nama Sektor","Kelompok","Output","NTB","Upah","Surplus","VA/Out%","Mult."].map(h=>(
                      <th key={h} style={{padding:"8px 10px",textAlign:"left",color:"#64748b",...mono,fontSize:10,borderBottom:"1px solid #334155"}}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {fSek.map((s,i)=>(
                      <tr key={s.id} style={{borderBottom:"1px solid #0f172a",background:i%2===0?"#0f172a":"#0a1628"}}>
                        <td style={{padding:"7px 10px",color:"#475569",...mono}}>{s.id}</td>
                        <td style={{padding:"7px 10px",color:"#e2e8f0",fontWeight:500}}>{s.nama}</td>
                        <td style={{padding:"7px 10px"}}><Badge c={GRP[s.grp]||"#22c55e"}>{s.grp}</Badge></td>
                        <td style={{padding:"7px 10px",color:"#f8fafc",...mono}}>{fmt(s.output)}</td>
                        <td style={{padding:"7px 10px",color:"#22c55e",...mono}}>{fmt(s.ntb)}</td>
                        <td style={{padding:"7px 10px",color:"#0ea5e9",...mono}}>{fmt(s.upah)}</td>
                        <td style={{padding:"7px 10px",color:"#f59e0b",...mono}}>{fmt(s.ntb-s.upah)}</td>
                        <td style={{padding:"7px 10px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:5}}>
                            <div style={{width:36,height:5,background:"#1e293b",borderRadius:3}}>
                              <div style={{width:`${(s.ntb/s.output*100).toFixed(0)}%`,height:"100%",background:"#22c55e",borderRadius:3}}/>
                            </div>
                            <span style={{fontSize:9,color:"#64748b",...mono}}>{(s.ntb/s.output*100).toFixed(0)}%</span>
                          </div>
                        </td>
                        <td style={{padding:"7px 10px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:5}}>
                            <div style={{width:36,height:5,background:"#1e293b",borderRadius:3}}>
                              <div style={{width:`${Math.min(100,(s.mult/5)*100)}%`,height:"100%",background:s.mult>2?"#f97316":s.mult>1.5?"#f59e0b":"#22c55e",borderRadius:3}}/>
                            </div>
                            <span style={{fontSize:10,color:"#f8fafc",...mono}}>{s.mult.toFixed(3)}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Sec>
          )}

          {(subTabIO||"ringkasan")==="matriks_z"&&(
            <Sec title="Matriks Transaksi Antara Z (30×30) — Juta Rupiah" accent="#22c55e"
              sub="Sel [baris i, kolom j] = nilai output sektor i yang digunakan sebagai input sektor j. Warna lebih gelap = nilai lebih besar. Klik header kolom/baris untuk highlight.">
              <MatriksIO ioMatrix={IO_MATRIX} defaultMode="Z"/>
            </Sec>
          )}

          {(subTabIO||"ringkasan")==="matriks_a"&&(
            <Sec title="Matriks Koefisien Teknis A = Z/X (30×30)" accent="#0ea5e9"
              sub="a_ij = Z_ij / X_j = berapa unit input sektor i per satu unit output sektor j. Nilai antara 0-1. Jumlah kolom + rasio NTB = 1.">
              <MatriksIO ioMatrix={IO_MATRIX} defaultMode="A"/>
            </Sec>
          )}
        </div>}

        {tab==="sam"&&<div>
          <Sec title="Social Accounting Matrix (SAM) 7×7" accent="#8b5cf6"
            sub="Baris = penerima (pendapatan), Kolom = pembayar (pengeluaran). Diagonal = transaksi internal. Satuan: Juta Rupiah.">
            <SankeySAM SAM={SAM}/>
            <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:10 }}>
              <button onClick={dlSAM} style={{ padding:"5px 14px",borderRadius:7,border:"none",background:"#8b5cf6",color:"#fff",cursor:"pointer",fontSize:11,fontWeight:700 }}>⬇ Download SAM (.csv)</button>
            </div>
          <div style={{ ...card,overflow:"auto",marginBottom:14 }}>
              <table style={{ width:"100%",borderCollapse:"collapse",fontSize:11,...mono }}>
                <thead><tr style={{ background:"#1e293b" }}>
                  <th style={{ padding:"9px 12px",color:"#64748b",borderBottom:"1px solid #334155",minWidth:110 }}>↓ Terima / Bayar →</th>
                  {(SAM.labels||[]).map(l=><th key={l} style={{ padding:"9px 12px",textAlign:"right",color:"#22c55e",borderBottom:"1px solid #334155",minWidth:100 }}>{l}</th>)}
                </tr></thead>
                <tbody>
                  {(SAM.matrix||[]).map((row,i)=>(
                    <tr key={i} style={{ borderBottom:"1px solid #0f172a",background:i%2===0?"#0f172a":"#0a1628" }}>
                      <td style={{ padding:"8px 12px",color:"#0ea5e9",fontWeight:700 }}>{(SAM.labels||[])[i]}</td>
                      {row.map((v,j)=>(
                        <td key={j} style={{ padding:"8px 12px",textAlign:"right",color:v===0?"#1e293b":i===j?"#f59e0b":"#e2e8f0" }}>
                          {v===0?"—":fmt(Math.round(v))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10 }}>
              {["Produksi","TK","Kapital","RT"].map((l,i)=>(
                <KPI key={l} label={`SAM Multiplier — ${l}`} value={((SAM.mult||[])[i]||0).toFixed(3)} unit="×" color={PAL[i]}/>
              ))}
            </div>
          </Sec>
        </div>}

        {/* LINKAGE */}
        {tab==="linkage"&&<div>
          <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:6 }}>
            <button onClick={dlLinkage} style={{ padding:"5px 14px",borderRadius:7,border:"none",background:"#f97316",color:"#fff",cursor:"pointer",fontSize:11,fontWeight:700 }}>⬇ Download Keterkaitan (.csv)</button>
          </div>

          {/* Grafik Kuadran Interaktif */}
          <Sec title="🗺️ Peta Kuadran Keterkaitan Sektoral (Interaktif)" accent="#22c55e"
            sub="Klik titik sektor untuk detail. Ukuran titik = multiplier output. Warna hijau = Sektor Kunci (prioritas kebijakan).">
            <KuadranChart sektor={sektor}/>
            {cge&&(
              <div style={{marginTop:12,background:"#1a0d00",borderRadius:8,padding:"10px 14px",
                borderLeft:"3px solid #f59e0b",fontSize:11,color:"#94a3b8",lineHeight:1.7}}>
                <strong style={{color:"#f59e0b"}}>ℹ️ Simulasi tidak mengubah posisi kuadran</strong>{" "}
                — Model CGE linier menggunakan matriks A yang konstan. BL, FL, dan multiplier adalah properti
                struktural I-O yang tidak berubah karena shock kebijakan. Untuk mengubah kuadran dibutuhkan
                <strong style={{color:"#22c55e"}}> perubahan struktural jangka panjang</strong>: investasi
                yang mengubah teknologi produksi dan proporsi input antara (misalnya industri hilir perikanan
                baru akan menaikkan FL sektor ikan dari 0.58 ke &gt; 1 sehingga masuk Kuadran II).
              </div>
            )}
          </Sec>

          <Sec title="Analisis Keterkaitan Sektoral (Backward & Forward Linkage)" accent="#f97316"
            sub="BL > 1 berarti sektor memiliki daya penyebaran ke belakang (menarik banyak input). FL > 1 berarti sektor penting sebagai pemasok ke depan.">
            <div style={{ display:"grid",gridTemplateColumns:"1.3fr 1fr",gap:14 }}>
              <div style={card}>
                <div style={{ fontSize:10,color:"#64748b",...mono,marginBottom:10 }}>DIAGRAM KUADRAN BL × FL</div>
                <ResponsiveContainer width="100%" height={340}>
                  <ScatterChart margin={{ top:10,right:10,bottom:20,left:10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                    <XAxis type="number" dataKey="x" name="BL" domain={[0,3.5]} label={{ value:"Backward Linkage (norm.)",position:"bottom",fill:"#64748b",fontSize:10 }} tick={{ fontSize:9,fill:"#64748b" }}/>
                    <YAxis type="number" dataKey="y" name="FL" domain={[0,4.5]} label={{ value:"Forward Linkage",angle:-90,position:"insideLeft",fill:"#64748b",fontSize:10 }} tick={{ fontSize:9,fill:"#64748b" }}/>
                    <ReferenceLine x={1} stroke="#334155" strokeDasharray="5 3"/>
                    <ReferenceLine y={1} stroke="#334155" strokeDasharray="5 3"/>
                    <Tooltip content={({payload})=>{
                      if(!payload?.length) return null;
                      const d=payload[0].payload;
                      return <div style={{ background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"10px 14px",fontSize:11 }}>
                        <div style={{ color:"#f8fafc",fontWeight:700,marginBottom:4 }}>{d.nama}</div>
                        <div style={{ color:"#94a3b8" }}>BL: <span style={{ color:"#f59e0b" }}>{d.x.toFixed(3)}</span></div>
                        <div style={{ color:"#94a3b8" }}>FL: <span style={{ color:"#0ea5e9" }}>{d.y.toFixed(3)}</span></div>
                      </div>;
                    }}/>
                    {Object.keys(GRP).map(g=>(
                      <Scatter key={g} name={g} data={sektor.filter(s=>s.grp===g).map(s=>({x:s.bl_n,y:s.fl_n,nama:s.nama,grp:s.grp}))} fill={GRP[g]} opacity={0.85}/>
                    ))}
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
                {[["TOP BACKWARD LINKAGE","bl_n","#f97316"],["TOP FORWARD LINKAGE","fl_n","#0ea5e9"]].map(([title,key,c])=>(
                  <div key={title} style={{ ...card,flex:1 }}>
                    <div style={{ fontSize:10,color:"#64748b",...mono,marginBottom:10 }}>{title}</div>
                    {[...sektor].sort((a,b)=>b[key]-a[key]).slice(0,7).map((s,i)=>(
                      <div key={s.id} style={{ display:"flex",alignItems:"center",gap:8,marginBottom:6 }}>
                        <span style={{ fontSize:9,color:"#475569",width:12,textAlign:"right" }}>{i+1}</span>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:10,color:"#e2e8f0",marginBottom:2 }}>{s.nama.slice(0,24)}</div>
                          <div style={{ background:"#1e293b",borderRadius:3,height:5 }}>
                            <div style={{ width:`${(s[key]/5)*100}%`,height:"100%",background:s[key]>1?c:"#475569",borderRadius:3 }}/>
                          </div>
                        </div>
                        <span style={{ fontSize:10,color:s[key]>1?c:"#475569",...mono,width:42,textAlign:"right" }}>{s[key].toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </Sec>
        </div>}

        {/* CGE SIMULASI */}
        {tab==="cge"&&<div>
          <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:6 }}>
            <button onClick={dlLaporan} style={{ padding:"5px 16px",borderRadius:7,border:"none",background:"#f97316",color:"#fff",cursor:"pointer",fontSize:11,fontWeight:700 }}>📄 Buka Laporan di Tab Baru</button>
          </div>
          {/* Sub-tab CGE */}
          <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
            {[
              ["simulasi",   "⚡ Simulasi & Transmisi"],
              ["dekomposisi","📊 Dekomposisi Dampak"],
              ["sensitivitas","🎛️ Uji Sensitivitas"],
              ["komparasi",  "⚖️ Bandingkan Skenario"],
              ["les",        "🛒 Konsumsi LES"],
              ["ihpihk",     "📈 IHP & IHK"],
            ].map(([k,l])=>(
              <Tab key={k} active={cgeSubTab===k} onClick={()=>setCgeSubTab(k)}>{l}</Tab>
            ))}
          </div>

          {cgeSubTab==="simulasi"&&(
          <Sec title="Model CGE — Simulasi Dampak Kebijakan" accent="#ec4899"
            sub="Pilih sektor, jenis kebijakan, dan besar shock. Platform menghitung dampak ke seluruh perekonomian via matriks Leontief + mekanisme transmisi SAM.">
            <div style={{ ...card,marginBottom:14 }}>
              <div style={{ display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:12 }}>
                <div>
                  <label style={{ fontSize:10,color:"#64748b",...mono,display:"block",marginBottom:4 }}>SEKTOR YANG DI-SHOCK</label>
                  <select value={si} onChange={e=>setSi(+e.target.value)}
                    style={{ width:"100%",background:"#0a1628",border:"1px solid #334155",borderRadius:8,color:"#f1f5f9",padding:"9px 12px",fontSize:12 }}>
                    {sektor.map((s,i)=><option key={s.id} value={i}>{s.id}. {s.nama} (mult={s.mult.toFixed(2)})</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:10,color:"#64748b",...mono,display:"block",marginBottom:4 }}>BESAR SHOCK (JUTA RP)</label>
                  <input type="number" value={amt} onChange={e=>setAmt(+e.target.value)} min={1000} step={50000}
                    style={{ width:"100%",background:"#0a1628",border:"1px solid #334155",borderRadius:8,color:"#f1f5f9",padding:"9px 12px",fontSize:12,boxSizing:"border-box" }}/>
                </div>
                <div>
                  <label style={{ fontSize:10,color:"#64748b",...mono,display:"block",marginBottom:4 }}>JENIS KEBIJAKAN</label>
                  <select value={stype} onChange={e=>setStype(e.target.value)}
                    style={{ width:"100%",background:"#0a1628",border:"1px solid #334155",borderRadius:8,color:"#f1f5f9",padding:"9px 12px",fontSize:12 }}>
                    {["investasi","subsidi","ekspor","belanja_pemerintah","pajak"].map(t=><option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1).replace("_"," ")}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {cge&&<>
              {/* Badge per jenis kebijakan */}
              <div style={{marginBottom:10,padding:"8px 14px",background:"#0a1628",borderRadius:8,
                display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                {[
                  {type:"investasi", label:"Investasi", color:"#22c55e",
                   note:"Multiplier penuh × 1.00 | MPC=0.68"},
                  {type:"subsidi",   label:"Subsidi",   color:"#0ea5e9",
                   note:"Efisiensi 82% × 0.82 | Ada deadweight loss"},
                  {type:"ekspor",    label:"Ekspor",    color:"#8b5cf6",
                   note:"Multiplier lebih besar × 1.08 | Impor input naik"},
                  {type:"belanja_pemerintah", label:"Belanja Gov", color:"#f59e0b",
                   note:"Efisiensi 90% × 0.90 | Defisit bertambah"},
                  {type:"pajak",     label:"Pajak",     color:"#ef4444",
                   note:"Kontraktif × -0.75 | Output TURUN"},
                ].map(b=>(
                  <div key={b.type} style={{display:"flex",alignItems:"center",gap:6,
                    opacity: stype===b.type ? 1 : 0.35, transition:"opacity 0.2s"}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:b.color,
                      boxShadow: stype===b.type ? `0 0 6px ${b.color}` : "none"}}/>
                    <span style={{fontSize:11,color:stype===b.type?b.color:"#64748b",fontWeight:stype===b.type?700:400}}>
                      {b.label}
                    </span>
                    {stype===b.type && (
                      <span style={{fontSize:10,color:"#64748b",...mono}}>— {b.note}</span>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14 }}>
                <KPI label="Multiplier Efektif" value={cge.effectiveMult.toFixed(3)} unit="×" color="#ec4899" icon="⚡"
                  sub={`Base ${cge.s.mult.toFixed(3)}× × ${cge.typeParams.multFactor.toFixed(2)}`}/>
                <KPI label="Total Dampak Output" value={fmt(Math.round(cge.total))} unit="Jt Rp" color="#22c55e" icon="📈"/>
                <KPI label="Dampak PDRB" value={`${cge.gdpEff>=0?"+":""}${cge.gdpEff.toFixed(2)}`} unit="%" color="#0ea5e9" icon="💹"/>
                <KPI label="Est. Lapangan Kerja" value={`~${fmt(cge.employEff)}`} unit="org" color="#f59e0b" icon="👷"/>
              </div>

              {/* INTERPRETASI */}
              <Interpretasi result={cge} sektor={sektor} makro={makro}/>

              <AliranNilaiCGE result={cge} makro={makro}/>
              {/* TRANSMISI DAMPAK */}
              <Sec title="🔀 Visualisasi Mekanisme Transmisi Dampak" accent="#f59e0b"
                sub="Klik salah satu langkah untuk menyorot. Animasi berjalan otomatis menampilkan alur dampak dari shock awal hingga efek berganda ke seluruh perekonomian.">
                <TransmisiDampak result={cge}/>
              </Sec>

              {/* Distribusi sektoral */}
              <Sec title="Distribusi Dampak ke Seluruh Sektor" accent="#06b6d4">
                <div style={card}>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={cge.sectorImpact.slice(0,15)} layout="vertical" margin={{ left:10,right:16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                      <XAxis type="number" tickFormatter={v=>fmtT(v)} tick={{ fontSize:9,fill:"#64748b" }}/>
                      <YAxis type="category" dataKey="nama" width={130} tick={{ fontSize:9,fill:"#94a3b8" }}/>
                      <Tooltip formatter={v=>`Rp ${fmt(v,0)} Jt`} contentStyle={{ background:"#1e293b",border:"1px solid #334155",borderRadius:8,fontSize:11 }}/>
                      <Bar dataKey="dampak" radius={[0,4,4,0]}>
                        {cge.sectorImpact.slice(0,15).map((d,i)=><Cell key={i} fill={GRP[d.grp]||"#22c55e"}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Sec>
            </>}
          </Sec>
          )}

          {/* FITUR 1: DEKOMPOSISI */}
          {cgeSubTab==="dekomposisi"&&(
            <Sec title="📊 Dekomposisi Dampak Kebijakan" accent="#22c55e"
              sub="Memisahkan total dampak menjadi komponen: langsung, tak langsung, harga, pendapatan-konsumsi, fiskal, dan kebocoran impor. Metodologi: linierisasi CGE (Sugema & Holis, 2015 — Bab 3).">
              {cge
                ? <DekomposisiDampak result={cge} params={cgeParams}/>
                : <div style={{...card,color:"#64748b",textAlign:"center",padding:30}}>
                    Jalankan simulasi dulu di tab ⚡ Simulasi & Transmisi
                  </div>
              }
            </Sec>
          )}

          {/* FITUR 2: SENSITIVITAS */}
          {cgeSubTab==="sensitivitas"&&(
            <Sec title="🎛️ Uji Sensitivitas Parameter" accent="#8b5cf6"
              sub="Geser nilai elastisitas Armington (σ_ARM), CET (σ_CET), dan MPC untuk melihat seberapa sensitif model terhadap perubahan parameter. Rekomendasi: uji stabilitas dengan rentang ±50% dari nilai base (Sugema & Holis, 2015 — Bab 2.5).">
              {cge
                ? <SensitivityPanel sektor={sektor} makro={makro} si={si} amt={amt} stype={stype}
                    params={cgeParams} setParams={setCgeParams}/>
                : <div style={{...card,color:"#64748b",textAlign:"center",padding:30}}>
                    Jalankan simulasi dulu di tab ⚡ Simulasi & Transmisi
                  </div>
              }
            </Sec>
          )}

          {/* FITUR 3: KOMPARASI */}
          {cgeSubTab==="komparasi"&&(
            <Sec title="⚖️ Komparasi Skenario Kebijakan A vs B" accent="#f97316"
              sub="Bandingkan dua kebijakan berbeda secara berdampingan. Contoh: subsidi pertanian vs investasi industri, atau intervensi di sektor berbeda dengan anggaran sama (Sugema & Holis, 2015 — Bab 2.5).">
              <SkenarioAB sektor={sektor} makro={makro}/>
            </Sec>
          )}

          {/* FITUR 4: LES */}
          {cgeSubTab==="les"&&(
            <Sec title="🛒 Fungsi Konsumsi LES / Stone-Geary" accent="#22c55e"
              sub="Konsumsi RT yang lebih realistis: setiap komoditas punya konsumsi minimum (γ) dulu, baru sisa pendapatan dibagi sesuai marginal budget share (β). Elastisitas pendapatan berbeda per komoditas (Sugema & Holis, 2015 — Bab 5.1.2).">
              <LESPanel cge={cge} makro={makro} si={si} amt={amt} stype={stype} sektor={sektor} setSi={setSi} setAmt={setAmt} setStype={setStype}/>
            </Sec>
          )}

          {/* FITUR 5: IHP & IHK */}
          {cgeSubTab==="ihpihk"&&(
            <Sec title="📈 Indeks Harga Produsen (IHP) & Konsumen (IHK)" accent="#f97316"
              sub="Estimasi dampak inflasi dari shock kebijakan — dipisah per kelompok produsen (IHP) dan komoditas konsumen (IHK). Pendapatan riil RT = Δ Pendapatan Nominal − Δ IHK (Sugema & Holis, 2015 — Bab 5.1.4 & 5.2.5).">
              <IHPIHKPanel cge={cge} sektor={sektor} makro={makro} si={si} amt={amt} stype={stype} setSi={setSi} setAmt={setAmt} setStype={setStype}/>
            </Sec>
          )}

        </div>}

        {/* TENAGA KERJA */}
        {tab==="tenaga"&&<div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))",gap:10,marginBottom:14 }}>
            <KPI label="Penduduk Usia Kerja" value={fmt(tk.puk)} unit="org" color="#f59e0b" icon="👥"/>
            <KPI label="Angkatan Kerja" value={fmt(tk.angkatan)} unit="org" color="#22c55e" icon="💼"/>
            <KPI label="Bekerja" value={fmt(tk.bekerja)} unit="org" color="#0ea5e9" icon="👷"/>
            <KPI label="TPAK" value={tk.tpak} unit="%" color="#f97316" icon="📊"/>
            <KPI label="TPT" value={tk.tpt} unit="%" color="#ef4444" icon="⚠️"/>
            <KPI label="Sektor Formal" value={tk.formal} unit="%" color="#8b5cf6" icon="🏢"/>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14 }}>
            <div style={card}>
              <div style={{ fontSize:10,color:"#64748b",...mono,marginBottom:10 }}>DISTRIBUSI LAPANGAN KERJA</div>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart><Pie data={(tk.sektor||[]).map(s=>({name:s.n,value:s.p}))} cx="50%" cy="50%" outerRadius={80} innerRadius={42} dataKey="value" paddingAngle={2}>
                  {(tk.sektor||[]).map((_,i)=><Cell key={i} fill={PAL[i]}/>)}</Pie>
                  <Tooltip formatter={v=>`${v}%`} contentStyle={{ background:"#1e293b",border:"1px solid #334155",borderRadius:8,fontSize:11 }}/>
                  <Legend iconSize={9} wrapperStyle={{ fontSize:10,color:"#94a3b8" }}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={card}>
              <div style={{ fontSize:10,color:"#64748b",...mono,marginBottom:10 }}>PEKERJA & TPT PER PENDIDIKAN</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={tk.pddk||[]} margin={{ bottom:5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                  <XAxis dataKey="l" tick={{ fontSize:10,fill:"#94a3b8" }}/>
                  <YAxis yAxisId="l" tickFormatter={v=>`${v}%`} tick={{ fontSize:8,fill:"#64748b" }} domain={[0,55]}/>
                  <YAxis yAxisId="r" orientation="right" tickFormatter={v=>`${v}%`} tick={{ fontSize:8,fill:"#64748b" }} domain={[0,14]}/>
                  <Tooltip formatter={v=>`${v}%`} contentStyle={{ background:"#1e293b",border:"1px solid #334155",borderRadius:8,fontSize:11 }}/>
                  <Legend wrapperStyle={{ color:"#94a3b8",fontSize:10 }}/>
                  <Bar yAxisId="l" dataKey="p" name="% Pekerja" fill="#0ea5e9" radius={[3,3,0,0]}/>
                  <Bar yAxisId="r" dataKey="tpt" name="TPT %" fill="#ef4444" radius={[3,3,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14 }}>
            <div style={card}>
              <div style={{ fontSize:10,color:"#64748b",...mono,marginBottom:10 }}>STATUS PEKERJAAN</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={tk.status||[]} layout="vertical" margin={{ left:10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                  <XAxis type="number" tickFormatter={v=>`${v}%`} tick={{ fontSize:9,fill:"#64748b" }} domain={[0,45]}/>
                  <YAxis type="category" dataKey="s" width={90} tick={{ fontSize:9,fill:"#94a3b8" }}/>
                  <Tooltip formatter={v=>`${v}%`} contentStyle={{ background:"#1e293b",border:"1px solid #334155",borderRadius:8,fontSize:11 }}/>
                  <Bar dataKey="p" radius={[0,4,4,0]}>
                    {(tk.status||[]).map((_,i)=><Cell key={i} fill={PAL[i]}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
              <div style={{ display:"flex",gap:10,flex:1 }}>
                {[["42,44%","Formal","#22c55e"],["57,57%","Informal","#f59e0b"]].map(([v,l,c])=>(
                  <div key={l} style={{ ...card,flex:1,textAlign:"center" }}>
                    <div style={{ fontSize:22,fontWeight:800,color:c }}>{v}</div>
                    <div style={{ fontSize:11,color:"#94a3b8",marginTop:4 }}>Sektor {l}</div>
                  </div>
                ))}
              </div>
              <div style={card}>
                <div style={{ fontSize:10,color:"#64748b",...mono,marginBottom:8 }}>TPAK MENURUT GENDER</div>
                {(tk.tpak_g||[]).map(({g,v})=>(
                  <div key={g} style={{ display:"flex",alignItems:"center",gap:10,marginBottom:6 }}>
                    <span style={{ fontSize:11,color:"#94a3b8",width:70 }}>{g}</span>
                    <div style={{ flex:1,height:8,background:"#1e293b",borderRadius:4 }}>
                      <div style={{ width:`${v}%`,height:"100%",background:g==="Laki-laki"?"#0ea5e9":"#ec4899",borderRadius:4 }}/>
                    </div>
                    <span style={{ fontSize:11,color:"#f8fafc",...mono,width:40,textAlign:"right" }}>{v}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>}

        {/* PANDUAN */}
        {tab==="metodologi"&&<PanelMetodologi/>}
        {tab==="analisis"&&<ContohAnalisis sektor={sektor} makro={makro} D={D}/>}
        {tab==="struktural"&&<AnalisisStruktural sektor={sektor} makro={makro}/>}
        {tab==="panduan"&&<PanduanCara/>}

      </div>
      <div style={{ borderTop:"1px solid #1e293b",padding:"12px 20px",display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:6 }}>
        <span style={{ fontSize:10,color:"#334155",...mono }}>Platform CGE Indonesia v2.0 · Metode: Regionalisasi RAS · BL/FL: Matriks Leontief · <span style={{color:"#22c55e",fontWeight:700}}>M@I-2026</span></span>
        <span style={{ fontSize:10,color:"#334155",...mono }}>Elastisitas: Armington σ=2.0 · CET σ=2.5 · TK η=0.8 (Oktaviani, 2008)</span>
      </div>

      {/* MODAL PREVIEW LAPORAN */}
      {showPreview && (
        <div style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",
          zIndex:9999,display:"flex",flexDirection:"column"
        }}>
          {/* Topbar modal */}
          <div style={{
            background:"#0a1628",borderBottom:"1px solid #1e293b",
            padding:"10px 20px",display:"flex",alignItems:"center",
            gap:12,flexShrink:0
          }}>
            <span style={{fontSize:13,fontWeight:700,color:"#f1f5f9",flex:1}}>
              📄 Laporan CGE — {D.nama} {D.tahun}
            </span>
            <button
              onClick={()=>{
                if(previewHTML){
                  const w=window.open("","_blank");
                  if(w){w.document.write(previewHTML);w.document.close();}
                }
              }}
              style={{padding:"6px 14px",borderRadius:7,border:"none",background:"#22c55e",color:"#0f172a",cursor:"pointer",fontSize:12,fontWeight:700}}
            >🖨️ Print / Save PDF</button>
            <button
              onClick={()=>{
                if(previewHTML){
                  const a=document.createElement("a");
                  a.href="data:text/html;charset=utf-8,"+encodeURIComponent(previewHTML);
                  a.download="Laporan_CGE_"+D.nama.replace(/\s/g,"_")+"_"+D.tahun+".html";
                  document.body.appendChild(a);a.click();document.body.removeChild(a);
                }
              }}
              style={{padding:"6px 14px",borderRadius:7,border:"1px solid #334155",background:"transparent",color:"#94a3b8",cursor:"pointer",fontSize:12}}
            >⬇ Download .html</button>
            <button
              onClick={()=>setShowPreview(false)}
              style={{padding:"6px 14px",borderRadius:7,border:"1px solid #334155",background:"transparent",color:"#ef4444",cursor:"pointer",fontSize:12,fontWeight:700}}
            >✕ Tutup</button>
          </div>
          {/* iframe konten laporan */}
          <iframe
            srcDoc={previewHTML}
            style={{flex:1,border:"none",background:"#fff"}}
            title="Laporan CGE"
          />
        </div>
      )}

    </div>
  );
}
