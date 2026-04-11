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

  const [hrvRaw, sleepRaw, vo2Raw] = await Promise.all([
    client.getHRV(date).catch(() => null),
    client.getSleepData(date).catch(() => null),
    client.getVO2Max(date).catch(() => null),
  ]);

  const hrv = hrvRaw as Record<string, unknown> | null;
  const sleep = sleepRaw as Record<string, unknown> | null;
  const vo2 = vo2Raw as Array<Record<string, unknown>> | null;

  const hrvSummary = hrv?.hrvSummary as Record<string, unknown> | null ?? null;
  const sleepDto = sleep?.dailySleepDTO as Record<string, unknown> | null ?? null;
  const sleepScores = sleepDto?.sleepScores as Record<string, Record<string, unknown>> | null ?? null;

  const vo2Value = (() => {
    if (!Array.isArray(vo2) || vo2.length === 0) return null;
    const generic = vo2[0]?.generic as Record<string, unknown> | null ?? null;
    return generic?.vo2MaxPreciseValue ?? generic?.vo2MaxValue ?? null;
  })();

  const payload = {
    type: 'health',
    date,
    vo2max: vo2Value,
    hrvLastNightAvg: hrvSummary?.lastNightAvg ?? null,
    hrvWeeklyAvg: hrvSummary?.weeklyAvg ?? null,
    hrvStatus: hrvSummary?.status ?? null,
    sleepScore: sleepScores?.overall?.value ?? null,
    sleepStart: formatTime(sleepDto?.sleepStartTimestampLocal as number | null ?? null),
    sleepEnd: formatTime(sleepDto?.sleepEndTimestampLocal as number | null ?? null),
    sleepDurationSeconds: sleepDto?.sleepTimeSeconds ?? null,
    deepSleepSeconds: sleepDto?.deepSleepSeconds ?? null,
    lightSleepSeconds: sleepDto?.lightSleepSeconds ?? null,
    remSleepSeconds: sleepDto?.remSleepSeconds ?? null,
    napSeconds: sleepDto?.napTimeSeconds ?? null,
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
    const activityId = activity.activityId as number;
    const zonesRaw = await client.getActivityHrZones(activityId).catch(() => null);
    const zones = zonesRaw as Array<Record<string, unknown>> | null;

    const zoneSeconds = (zoneNum: number): number | null => {
      if (!Array.isArray(zones)) return null;
      const z = zones.find((z) => z.zoneNumber === zoneNum);
      return z?.secsInZone != null ? (z.secsInZone as number) : null;
    };

    const payload = {
      type: 'activity',
      activityType: (activity.activityType as Record<string, unknown> | null)?.typeKey ?? null,
      startTimeLocal: activity.startTimeLocal,
      duration: activity.duration ?? null,
      kcal: activity.calories ?? null,
      averageHR: activity.averageHR ?? null,
      maxHR: activity.maxHR ?? null,
      aerobicTrainingEffect: activity.aerobicTrainingEffect ?? null,
      anaerobicTrainingEffect: activity.anaerobicTrainingEffect ?? null,
      hrTimeInZone_1: zoneSeconds(1),
      hrTimeInZone_2: zoneSeconds(2),
      hrTimeInZone_3: zoneSeconds(3),
      hrTimeInZone_4: zoneSeconds(4),
      hrTimeInZone_5: zoneSeconds(5),
      waterEstimated: activity.waterEstimated ?? null,
    };

    await postToMake(payload);
    console.error(`Activity ${activityId} sent.`);
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
