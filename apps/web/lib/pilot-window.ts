import { getRuntimeValue } from '@/db/index';

import { AppError } from './errors';

export type PilotMetricWindow = {
  configured: boolean;
  startAt: number | null;
  endAt: number | null;
};

export function getPilotMetricWindow(): PilotMetricWindow {
  const startRaw = getRuntimeValue('PILOT_WINDOW_START')?.trim() ?? '';
  const endRaw = getRuntimeValue('PILOT_WINDOW_END')?.trim() ?? '';
  if (!startRaw && !endRaw) {
    return { configured: false, startAt: null, endAt: null };
  }
  if (!startRaw || !endRaw) {
    throw new AppError(
      503,
      'pilot_window_incomplete',
      '试点指标窗口必须同时配置开始和结束时间。',
    );
  }
  const zonedIsoPattern =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u;
  if (!zonedIsoPattern.test(startRaw) || !zonedIsoPattern.test(endRaw)) {
    throw new AppError(
      503,
      'pilot_window_timezone_required',
      '试点指标窗口必须使用带时区的 ISO 时间。',
    );
  }
  const startAt = Math.floor(Date.parse(startRaw) / 1_000);
  const endAt = Math.floor(Date.parse(endRaw) / 1_000);
  if (
    !Number.isFinite(startAt) ||
    !Number.isFinite(endAt) ||
    endAt <= startAt
  ) {
    throw new AppError(
      503,
      'pilot_window_invalid',
      '试点指标窗口无效；请使用带时区的 ISO 时间，并确保结束晚于开始。',
    );
  }
  return { configured: true, startAt, endAt };
}
