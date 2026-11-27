export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const k = 1024;
  const idx = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    units.length - 1
  );
  const value = bytes / Math.pow(k, idx);
  const fixed = idx === 0 ? 0 : decimals;
  return `${value.toFixed(fixed)} ${units[idx]}`;
}

export function formatUptime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "0 dk";
  }
  const secs = Math.floor(totalSeconds);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}g`);
  if (hours > 0) parts.push(`${hours}s`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}dk`);
  return parts.join(" ");
}

export function formatPct(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  const clamped = Math.max(0, Math.min(100, value));
  return `${clamped.toFixed(decimals)}%`;
}

export function formatMegabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB";
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${Math.round(mb)} MB`;
}
