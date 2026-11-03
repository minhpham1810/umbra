export interface Progress { best: Record<number, number>; unlocked: number }
export function parseProgress(raw: string | null): Progress {
  const result: Progress = { best: {}, unlocked: 0 };
  try {
    const data: unknown = JSON.parse(raw ?? '{}');
    if (typeof data !== 'object' || !data) return result;
    const best = (data as {best?: unknown}).best;
    if (typeof best !== 'object' || !best || Array.isArray(best)) return result;
    for (const [key, value] of Object.entries(best)) {
      const i = Number(key);
      if (Number.isInteger(i) && i >= 0 && i < 5 && typeof value === 'number' && Number.isFinite(value) && value > 0) result.best[i] = value;
    }
    while (result.unlocked < 4 && result.best[result.unlocked] !== undefined) result.unlocked++;
  } catch { /* Unavailable or corrupt storage should never prevent play. */ }
  return result;
}
export function recordWin(progress: Progress, index: number, ticks: number): Progress {
  if (!Number.isInteger(index) || index < 0 || index > 4 || !Number.isFinite(ticks) || ticks <= 0) return progress;
  return { best: { ...progress.best, [index]: Math.min(progress.best[index] ?? Infinity, ticks) }, unlocked: Math.min(4, Math.max(progress.unlocked, index + 1)) };
}
export function formatTime(ticks: number): string {
  const seconds = Math.floor(ticks / 60);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
