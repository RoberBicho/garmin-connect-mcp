import { GarminClient } from './client';

const GARMIN_EMAIL = process.env.GARMIN_EMAIL;
const GARMIN_PASSWORD = process.env.GARMIN_PASSWORD;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

if (!GARMIN_EMAIL || !GARMIN_PASSWORD) {
  console.error('Error: GARMIN_EMAIL and GARMIN_PASSWORD are required');
  process.exit(1);
}

if (!MAKE_WEBHOOK_URL) {
  console.error('Error: MAKE_WEBHOOK_URL is required');
  process.exit(1);
}

function todayString(): string {
  return new Date().toISOString().split('T')[0]!;
}

function secondsToMinutes(seconds: number | null | undefined): number | null {
  if (seconds == null) return null;
  return Math.round(seconds / 60);
}

function formatTime(timestampLocal: number | null | undefined): string | null {
  if (timestampLocal == null) return null;
  const d = new Date(timestampLocal);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function postToMake(payload: unknown): Promise<void> {
  const res = await fetch(MAKE_WEBHOOK_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Make webhook returned ${res.status}: ${await res.text()}`);
  }
}

async function syncHealth(client: GarminClient, date: string): Promise<void> {
  console.error(`Syncing health data for ${date}...`);

  const hrvRaw = await client.getHRV(date).catch(() => null);
  const sleepRaw = await client.getSleepData(date).catch(() => null);
  const vo2Raw = await client.getVO2Max(date).catch(() => null);

  const hrv = hrvRaw as Record<string, unknown> | null;
  const sleep = sleepRaw as Record<string, unknown> | null;
  const vo2 = vo2Raw as Record<string, unknown> | null;

  const hrvSummary = hrv?.hrvSummary as Record<string, unknown> | null ?? null;
  const sleepDto = sleep?.dailySleepDTO as Record<string, unknown> | null ?? null;
  const napDto = sleep?.napDTO as Record<string, unknown> | null ?? null;

  const vo2Value = (() => {
    if (!vo2) return null;
    const generic = vo2.vo2MaxPreciseValue ?? vo2.vo2MaxValue;
    return generic ?? null;
  })();

  const sleepStartTs = sleepDto?.sleepStartTimestampLocal as number | null ?? null;
  const sleepEndTs = sleepDto?.sleepEndTimestampLocal as number | null ?? null;
  const napStartTs = napDto?.startGMT as string | null ?? null;
  const napDuration = napDto
    ? secondsToMinutes((napDto.durationInSeconds as number | null) ?? null)
    : 0;

  const payload = {
    type: 'health',
    date,
    data: {
      vo2max: vo2Value,
      hrv_night_avg: hrvSummary?.lastNightAvg ?? null,
      hrv_weekly_avg: hrvSummary?.weeklyAvg ?? null,
      hrv_status: hrvSummary?.status ?? null,
      sleep_score: (sleepDto?.sleepScores as Record<string, Record<string, unknown>> | null)?.overall?.value ?? null,
      sleep_start: formatTime(sleepStartTs),
      sleep_end: formatTime(sleepEndTs),
      sleep_duration_min: secondsToMinutes(
        ((sleepDto?.deepSleepSeconds as number | null) ?? 0) +
        ((sleepDto?.lightSleepSeconds as number | null) ?? 0) +
        ((sleepDto?.remSleepSeconds as number | null) ?? 0),
      ),
      deep_sleep_min: secondsToMinutes(sleepDto?.deepSleepSeconds as number | null ?? null),
      light_sleep_min: secondsToMinutes(sleepDto?.lightSleepSeconds as number | null ?? null),
      rem_min: secondsToMinutes(sleepDto?.remSleepSeconds as number | null ?? null),
      nap_start: napStartTs,
      nap_min: napDuration,
    },
  };

  await postToMake(payload);
  console.error('Health payload sent.');
}

async function syncActivities(client: GarminClient, date: string): Promise<void> {
  console.error(`Syncing activities for ${date}...`);

  const raw = await client.getActivitiesByDate(date, date);
  const activities = raw as Record<string, unknown>[];

  if (!Array.isArray(activities) || activities.length === 0) {
    console.error('No activities found for this date.');
    return;
  }

  for (const activity of activities) {
    const payload = {
      type: 'activity',
      date,
      data: {
        activityId: activity.activityId,
        activityType: (activity.activityType as Record<string, unknown> | null)?.typeKey ?? null,
        activityName: activity.activityName,
        startTimeLocal: activity.startTimeLocal,
        duration_min: activity.duration != null ? Math.round((activity.duration as number) / 60) : null,
        kcal: activity.calories,
        averageHR: activity.averageHR,
        maxHR: activity.maxHR,
        aerobicTrainingEffect: activity.aerobicTrainingEffect,
        anaerobicTrainingEffect: activity.anaerobicTrainingEffect,
        hrTimeInZone_1: activity.hrTimeInZone_1,
        hrTimeInZone_2: activity.hrTimeInZone_2,
        hrTimeInZone_3: activity.hrTimeInZone_3,
        hrTimeInZone_4: activity.hrTimeInZone_4,
        hrTimeInZone_5: activity.hrTimeInZone_5,
        waterEstimated: activity.waterEstimated,
      },
    };

    await postToMake(payload);
    console.error(`Activity ${activity.activityId} sent.`);
  }
}

async function main(): Promise<void> {
  const date = process.env.SYNC_DATE ?? todayString();
  const client = new GarminClient(GARMIN_EMAIL!, GARMIN_PASSWORD!);

  console.error(`Starting Garmin sync for date: ${date}`);

  await syncHealth(client, date);
  await syncActivities(client, date);

  console.error('Sync complete.');
}

main().catch((error) => {
  console.error('Fatal error during sync:', error);
  process.exit(1);
});
