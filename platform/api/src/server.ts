import { buildApp } from './app.js';
import { FixtureDirectoryRepository } from './fixture-repository.js';
import { loadPlatformEnv } from './load-env.js';
import { PostgresDirectoryRepository } from './postgres-repository.js';
import type { DirectoryRepository } from './types.js';
import { createAssistantPlanner } from './map-assistant.js';
import { createJsonModel } from './ai-client.js';
import { Pool } from 'pg';
import { createMailerFromEnv } from './mailer.js';
import { createPushSender, PostgresPushStore, PushDispatcher, type PushStore } from './push.js';

loadPlatformEnv();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const dataSource = process.argv.includes('--fixture') ? 'fixture' : (process.env.API_DATA_SOURCE || 'postgres');
const repository: DirectoryRepository = dataSource === 'fixture'
  ? new FixtureDirectoryRepository({ pilotAreas: process.argv.includes('--pilot-areas') || process.env.API_FIXTURE_PILOT_AREAS === 'true' })
  : new PostgresDirectoryRepository(required('DATABASE_URL'));

// Thông báo đẩy: chỉ gửi khi có khóa FCM và dùng cơ sở dữ liệu thật. Không có khóa thì API vẫn chạy bình thường.
const pushSender = createPushSender(process.env);
const pushPool = dataSource === 'fixture' ? undefined : new Pool({ connectionString: required('DATABASE_URL'), max: 2 });
const pushStore: PushStore | undefined = pushPool ? new PostgresPushStore(pushPool) : undefined;
const pushDispatcher = pushSender && pushStore
  ? new PushDispatcher(pushStore, pushSender, { intervalMs: Number(process.env.PUSH_POLL_INTERVAL_MS) || 15_000 })
  : null;

const app = await buildApp(repository, {
  pushStore,
  pushEnabled: Boolean(pushSender),
  corsOrigin: process.env.API_CORS_ORIGIN || 'http://localhost:5173',
  enableLocalWorkflows: process.env.API_ENABLE_LOCAL_WORKFLOWS !== 'false',
  officerSessionSecret: required('API_OFFICER_SESSION_SECRET'),
  officerCredentials: [
    {
      username: required('API_OFFICER_USERNAME'),
      password: required('API_OFFICER_PASSWORD'),
      actorId: process.env.API_OFFICER_ACTOR_ID || 'officer-demo-xuan-huong',
    },
  ],
  citizenSessionSecret: process.env.API_CITIZEN_SESSION_SECRET || required('API_OFFICER_SESSION_SECRET'),
  citizenCredentials: [{
    username: required('API_CITIZEN_USERNAME'),
    password: required('API_CITIZEN_PASSWORD'),
    citizenId: process.env.API_CITIZEN_ID || 'citizen-xuan-huong-pilot',
    displayName: process.env.API_CITIZEN_DISPLAY_NAME || 'Người dân Xuân Hương',
  }],
  secureCookies: process.env.NODE_ENV === 'production',
  assistantPlanner: createAssistantPlanner(process.env),
  assistantDailyLimit: Number(process.env.AI_DAILY_REQUEST_LIMIT || 200),
  aiModel: createJsonModel(process.env),
  aiDailyLimit: Number(process.env.AI_DAILY_REQUEST_LIMIT || 200),
  releaseValidation: process.env.API_RELEASE_VALIDATION === 'true' && process.env.NODE_ENV !== 'production',
  mailer: createMailerFromEnv(process.env) ?? undefined,
});

app.addHook('onClose', async () => {
  pushDispatcher?.stop();
  await pushPool?.end();
});

const host = process.env.API_HOST || '127.0.0.1';
const port = Number(process.env.API_PORT || 3001);

await app.listen({ host, port });
pushDispatcher?.start();
const mailerStatus = createMailerFromEnv(process.env, () => undefined)?.kind ?? 'off';
console.log(`CSKV API listening on http://${host}:${port} (${repository.sourceName}; push ${pushDispatcher ? 'on' : 'off'}; email ${mailerStatus})`);
