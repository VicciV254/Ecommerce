import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { formatNairobiClock, formatNairobiDate } from '../../utils/nairobiDate';

/* Sales report downloads, built in the browser from the report the API returned; names and titles carry its dates. */

/** Spreadsheet apps run a cell that starts with one of these as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One quoted CSV cell. Text that would start a formula (customer names and emails are typed by shoppers) gets a leading
 * apostrophe so it opens as text; amounts stay numbers.
 */
function csvCell(value: unknown) {
  const text = String(value ?? "");
  const cell = typeof value !== "number" && FORMULA_START.test(text) ? `'${text}` : text;
  return `"${cell.replace(/"/g, '""')}"`;
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadExcel(filename: string, rows: Record<string, unknown>[], title: string) {
  if (!rows.length) return;
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  workbook.Props = { Title: title };
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

/** `generatedAt` is when the API made the report (an ISO instant), stated in Nairobi time. */
export function downloadPdf(filename: string, rows: Record<string, unknown>[], title: string, brandName: string, generatedAt: string) {
  if (!rows.length) return;
  const doc = new jsPDF();
  
  // Apex Cart navy and gold text (gold text, not gold 500, stays readable on white paper)
  const brandPrimary = "#14213D";
  const brandSecondary = "#765619";
  
  // Brand heading
  doc.setFontSize(20);
  doc.setTextColor(parseInt(brandPrimary.slice(1, 3), 16), parseInt(brandPrimary.slice(3, 5), 16), parseInt(brandPrimary.slice(5, 7), 16));
  doc.text(brandName, 14, 20);
  
  // Title: the report and its dates
  doc.setFontSize(14);
  doc.setTextColor(parseInt(brandSecondary.slice(1, 3), 16), parseInt(brandSecondary.slice(3, 5), 16), parseInt(brandSecondary.slice(5, 7), 16));
  doc.text(title, 14, 32);
  
  // When the API made it
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated ${formatNairobiDate(generatedAt)}, ${formatNairobiClock(generatedAt)} (Nairobi time)`, 14, 42);
  
  // Generate table
  const headers = Object.keys(rows[0]);
  const data = rows.map(row => headers.map(header => String(row[header] ?? "")));
  
  autoTable(doc, {
    head: [headers],
    body: data,
    startY: 50,
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
