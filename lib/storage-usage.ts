import { QUOTAS } from "./quotas";
export function storageNotice(
  bytes: number | string | null,
  measuredAt: Date | string | null,
  now = Date.now(),
) {
  if (
    bytes == null ||
    measuredAt == null ||
    !Number.isFinite(Number(bytes)) ||
    Number(bytes) < 0
  )
    return "Upload storage measurement is unavailable. Please contact support if this persists.";
  const age = now - new Date(measuredAt).getTime();
  if (!Number.isFinite(age) || age > 2 * 3600_000 || age < -60_000)
    return "Upload storage measurement is out of date. Please contact support if this persists.";
  const ratio = Number(bytes) / (QUOTAS.storageGB * 1_000_000_000);
  const configured = Number(process.env.STORAGE_WARNING_RATIO);
  const threshold =
    configured > 0 && configured <= 1 ? configured : QUOTAS.storageWarningRatio;
  if (ratio < threshold) return null;
  return `Uploads use ${Math.floor(ratio * 100)}% of your ${QUOTAS.storageGB} GB included storage (${(Number(bytes) / 1_000_000_000).toFixed(2)} GB). Uploads are not automatically blocked. Contact support to discuss more storage.`;
}
