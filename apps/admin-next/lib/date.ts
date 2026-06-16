export function parseUtcTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(text)
    ? `${text.replace(" ", "T")}${text.length === 16 ? ":00" : ""}Z`
    : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = parseUtcTimestamp(value);
  if (!date) return String(value);
  return date.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = parseUtcTimestamp(value);
  if (!date) return String(value).slice(2, 10).replace(/-/g, ".");
  return date.toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).replace(/\s/g, "").replace(/\.$/, "");
}
