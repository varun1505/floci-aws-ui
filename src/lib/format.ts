export function formatBytes(n: number | undefined): string {
  if (n === undefined || n === null) return "-";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function formatDate(d: Date | string | number | undefined): string {
  if (d === undefined || d === null || d === "" || d === 0) return "-";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const err = e as { name?: string; message?: string };
    if (err.name && err.message && err.name !== "Error") return `${err.name}: ${err.message}`;
    if (err.message) return err.message;
  }
  return String(e);
}

export function download(data: Uint8Array | string, filename: string, type = "application/octet-stream") {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
