const WHOLE_AMOUNT = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });
const CENT_AMOUNT = new Intl.NumberFormat("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE_TIME = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" });

/** Server amounts carry at most two decimals; fractional amounts always show both digits. */
export function formatKES(amount: number) {
  return `KES ${(Number.isInteger(amount) ? WHOLE_AMOUNT : CENT_AMOUNT).format(amount)}`;
}

/** Local date and time for a server timestamp. */
export function formatDateTime(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_TIME.format(date);
}
