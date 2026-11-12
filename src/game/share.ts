/** The round result as a short piece of text, and the date helpers behind the daily round. */

export type RoundKind = "daily" | "free";

/** Local calendar date as YYYY-MM-DD: the key the daily round is seeded from. */
export function dateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "13 Nov 2026" */
export function dateLabel(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function shareText(score: number, kind: RoundKind, date: Date, url: string): string {
  const head = kind === "daily" ? `Junction · ${dateLabel(date)}` : "Junction · free play";
  const body =
    score === 0
      ? "Crashed before a single delivery."
      : `${score} ${score === 1 ? "vehicle" : "vehicles"} delivered before the crash.`;
  return url ? `${head}\n${body}\n${url}` : `${head}\n${body}`;
}

/** Copy text to the clipboard, with a fallback for browsers that block the modern API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
