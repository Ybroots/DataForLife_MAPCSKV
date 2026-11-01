import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { FixtureDirectoryRepository } from '../src/fixture-repository.js';

/**
 * Bất biến của bề mặt API, kiểm tra trên từng route khai báo trong các file *-routes.ts:
 * mọi route cán bộ và người dân đều đòi phiên đăng nhập, và đều tắt được cùng lúc bằng cờ workflow.
 * Test này bắt lỗi khi tách hoặc thêm route mà quên cổng kiểm tra.
 */
const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function declaredRoutes(): Array<{ method: string; url: string }> {
  const routes = new Map<string, { method: string; url: string }>();
  for (const file of fs.readdirSync(sourceDirectory).filter((name) => name.endsWith('-routes.ts'))) {
    const code = fs.readFileSync(path.join(sourceDirectory, file), 'utf8');
    for (const match of code.matchAll(/\bapp\.(get|post|patch|delete)(?:<[^\n]*?>)?\(\s*'([^']+)'/g)) {
      const method = match[1]!.toUpperCase();
      routes.set(`${method} ${match[2]}`, { method, url: match[2]!.replace(/:\w+/g, 'abc-123') });
    }
  }
  return [...routes.values()].sort((a, b) => `${a.url} ${a.method}`.localeCompare(`${b.url} ${b.method}`));
}

const routes = declaredRoutes();
const officerRoutes = routes.filter((route) => route.url.startsWith('/v1/officer/'));
const citizenRoutes = routes.filter((route) => route.url.startsWith('/v1/citizen/'));

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

async function call(instance: FastifyInstance, route: { method: string; url: string }) {
  const hasBody = route.method === 'POST' || route.method === 'PATCH';
  return instance.inject({
    method: route.method as 'GET',
    url: route.url,
    ...(hasBody ? { headers: { 'content-type': 'application/json' }, payload: '{}' } : {}),
  });
}

describe('cổng kiểm tra của từng route', () => {
  it('đọc được đủ route cán bộ và người dân từ mã nguồn', () => {
    expect(officerRoutes.length).toBeGreaterThanOrEqual(22);
    expect(citizenRoutes.length).toBeGreaterThanOrEqual(15);
  });

  it('route cán bộ trả 401 khi chưa đăng nhập', async () => {
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost:5173', officerSessionSecret: 's'.repeat(40), citizenSessionSecret: 'c'.repeat(40) });
    for (const route of officerRoutes) {
      const response = await call(app, route);
      expect([response.statusCode, response.json().error], `${route.method} ${route.url}`).toEqual([401, 'OFFICER_SESSION_REQUIRED']);
    }
  });

  it('route người dân trả 401 khi chưa đăng nhập', async () => {
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost:5173', officerSessionSecret: 's'.repeat(40), citizenSessionSecret: 'c'.repeat(40) });
    for (const route of citizenRoutes) {
      const response = await call(app, route);
      expect([response.statusCode, response.json().error], `${route.method} ${route.url}`).toEqual([401, 'CITIZEN_SESSION_REQUIRED']);
    }
  });

  it('tắt workflow thì mọi route cán bộ và người dân trả 503', async () => {
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost:5173', enableLocalWorkflows: false });
    for (const route of [...officerRoutes, ...citizenRoutes]) {
      const response = await call(app, route);
      // Đăng xuất không ghi dữ liệu nên không bị cổng workflow chặn.
      if (route.url.endsWith('/logout')) continue;
      expect([response.statusCode, response.json().error], `${route.method} ${route.url}`).toEqual([503, 'WORKFLOW_DISABLED']);
    }
  });
});
