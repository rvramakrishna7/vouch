/**
 * Shared formatting helpers for consistent UI presentation.
 * Format requirement (AGENTS.md 7e.3): "23 Oct 2026, 11:08"
 */

export function formatDate(input?: string | number | Date | null): string {
  if (!input) return "—";
  const d = typeof input === "object" && input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return "—";

  const day = d.getDate();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");

  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

/**
 * Shortens long entity identifiers like "content:fd4ebc26-8971-46ab-8209-1e35d1f879ab"
 * to "content · fd4ebc26" with full id preserved for title tooltips.
 */
export function formatEntityShort(entity?: string | null): { short: string; full: string } {
  if (!entity) return { short: "—", full: "—" };
  const parts = entity.split(":");
  if (parts.length >= 2) {
    const prefix = parts[0];
    const rest = parts.slice(1).join(":");
    const shortId = rest.length > 8 ? rest.slice(0, 8) : rest;
    return { short: `${prefix} · ${shortId}`, full: entity };
  }
  return { short: entity.length > 16 ? entity.slice(0, 16) : entity, full: entity };
}
