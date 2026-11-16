import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

/* Sales report downloads, built in the browser from the report the API returned. */

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => `"${String(row[header] ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadExcel(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  
  // Add brand colors to header
  const range = XLSX.utils.decode_range(worksheet['!ref'] || "A1");
  for (let C = range.s.c; C <= range.e.c; ++C) {
    const address = XLSX.utils.encode_col(C) + "1";
    if (!worksheet[address]) continue;
    worksheet[address].s = {
      fill: { fgColor: { rgb: "2B1B12" } },
      font: { color: { rgb: "FFFFFF" }, bold: true },
    };
  }
  
  XLSX.writeFile(workbook, filename);
}

export function downloadPdf(filename: string, rows: Record<string, unknown>[], title: string, brandName: string) {
  if (!rows.length) return;
  const doc = new jsPDF();
  
  // Apex Cart navy and gold text (gold text, not gold 500, stays readable on white paper)
  const brandPrimary = "#14213D";
  const brandSecondary = "#765619";
  
  // Brand heading
  doc.setFontSize(20);
  doc.setTextColor(parseInt(brandPrimary.slice(1, 3), 16), parseInt(brandPrimary.slice(3, 5), 16), parseInt(brandPrimary.slice(5, 7), 16));
  doc.text(brandName, 14, 20);
  
  doc.setFontSize(10);
  doc.setTextColor(parseInt(brandSecondary.slice(1, 3), 16), parseInt(brandSecondary.slice(3, 5), 16), parseInt(brandSecondary.slice(5, 7), 16));
  doc.text("Financial Report", 14, 28);
  
  // Add title
  doc.setFontSize(16);
  doc.setTextColor(parseInt(brandPrimary.slice(1, 3), 16), parseInt(brandPrimary.slice(3, 5), 16), parseInt(brandPrimary.slice(5, 7), 16));
  doc.text(title, 14, 40);
  
  // Add date
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 48);
  
  // Generate table
  const headers = Object.keys(rows[0]);
  const data = rows.map(row => headers.map(header => String(row[header] ?? "")));
  
  autoTable(doc, {
    head: [headers],
    body: data,
    startY: 55,
    headStyles: {
      fillColor: [20, 33, 61],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
    },
    styles: {
      fontSize: 9,
      cellPadding: 3,
    },
  });
  
  doc.save(filename);
}
