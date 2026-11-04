import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { FixtureDirectoryRepository } from '../src/fixture-repository.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('directory API', () => {
  it('provides all public overview geometry with no directory or raw source data', async () => {
    app = await buildApp(new FixtureDirectoryRepository());
    const response = await app.inject({ method: 'GET', url: '/v1/areas/overview' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    const overview = response.json().data;
    expect(overview.type).toBe('FeatureCollection');
    expect(overview.features).toHaveLength(1);
    expect(overview.features[0].properties.code).toBe('DEMO-DA-LAT');
    expect(Object.keys(overview.features[0].properties).sort()).toEqual(['code', 'localityType', 'name', 'provinceName']);
    expect(overview.features[0].geometry.coordinates.length).toBeGreaterThan(0);
  });
  it('resolves a locality by coordinates and returns its directory', async () => {
    app = await buildApp(new FixtureDirectoryRepository());
    const response = await app.inject({
      method: 'GET',
      url: '/v1/lookup/by-location?lat=11.944&lng=108.441',
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.data.code).toBe('DEMO-DA-LAT');
    expect(payload.data.directory).toHaveLength(1);
    expect(payload.data.directory[0].displayName).toBe('Cảnh sát khu vực phụ trách');
    expect(payload.data.directory[0].rank).toBeNull();
    expect(payload.data.serviceAreas).toEqual([]);
    expect(payload.meta.dataSource).toBe('fixture');
  });

  it('rejects invalid coordinates', async () => {
    app = await buildApp(new FixtureDirectoryRepository());
    const response = await app.inject({
      method: 'GET',
      url: '/v1/lookup/by-location?lat=999&lng=108.441',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_COORDINATES');
  });

  it('searches areas without exposing Firestore', async () => {
    app = await buildApp(new FixtureDirectoryRepository());
    const response = await app.inject({ method: 'GET', url: '/v1/areas?query=Xuân' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0].name).toContain('Xuân Hương');
  });
});

describe('local operational workflows', () => {
  const citizenHeaders = { 'x-citizen-id': 'citizen-test-001' };
  const officerHeaders = { 'x-officer-id': 'officer-demo-xuan-huong' };
  const incidentAttachments = [{
    fileName: 'hien-truong.png', mimeType: 'image/png', sizeBytes: 68, dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4N8AAAAASUVORK5CYII=',
  }];

  it('creates an incident idempotently and isolates it by citizen identity', async () => {
    app = await buildApp(new FixtureDirectoryRepository());
    const body = {
      clientRequestId: 'request-test-0001',
      category: 'security',
      summary: 'Phản ánh kiểm thử hợp lệ',
      description: 'Nội dung kiểm thử đủ dài để tạo phản ánh trong workflow local.',
      latitude: 11.944,
      longitude: 108.441,
      accuracyM: 12,
      attachments: incidentAttachments,
    };

    const first = await app.inject({ method: 'POST', url: '/v1/citizen/incidents', headers: citizenHeaders, payload: body });
    const repeated = await app.inject({ method: 'POST', url: '/v1/citizen/incidents', headers: citizenHeaders, payload: body });
    expect(first.statusCode).toBe(201);
    expect(repeated.statusCode).toBe(201);
    expect(repeated.json().data.id).toBe(first.json().data.id);
    expect(first.json().data.attachments).toMatchObject([{ fileName: 'hien-truong.png', mimeType: 'image/png', sizeBytes: 68 }]);
    expect(first.json().meta.emergencyDispatchConnected).toBe(false);

    const hiddenFromAnotherCitizen = await app.inject({
      method: 'GET',
      url: `/v1/citizen/incidents/${first.json().data.receiptCode}`,
      headers: { 'x-citizen-id': 'citizen-test-002' },
    });
    expect(hiddenFromAnotherCitizen.statusCode).toBe(404);
  });

  it('enforces incident state transitions and exposes the immutable timeline', async () => {
    app = await buildApp(new FixtureDirectoryRepository());
    const created = await app.inject({
      method: 'POST',
      url: '/v1/citizen/incidents',
      headers: citizenHeaders,
      payload: {
        clientRequestId: 'request-test-0002', category: 'traffic',
        summary: 'Phản ánh giao thông cần xử lý',
        description: 'Xe dừng đỗ cản trở lối đi trong khu vực vào thời điểm kiểm thử.',
        latitude: 11.944, longitude: 108.441,
        attachments: incidentAttachments,
      },
    });
    const id = created.json().data.id as string;

    const invalid = await app.inject({
      method: 'POST', url: `/v1/officer/incidents/${id}/transitions`, headers: officerHeaders,
      payload: { toStatus: 'resolved', note: 'Bỏ qua các bước bắt buộc.' },
    });
    expect(invalid.statusCode).toBe(409);
    expect(invalid.json().error).toBe('INVALID_TRANSITION');

    const received = await app.inject({
      method: 'POST', url: `/v1/officer/incidents/${id}/transitions`, headers: officerHeaders,
      payload: { toStatus: 'received', note: 'Trực ban đã kiểm tra nội dung ban đầu.' },
    });
    expect(received.statusCode).toBe(200);
    expect(received.json().data.status).toBe('received');
    expect(received.json().data.history).toHaveLength(2);

    const citizenView = await app.inject({
      method: 'GET', url: `/v1/citizen/incidents/${created.json().data.receiptCode}`, headers: citizenHeaders,
    });
    expect(citizenView.json().data.status).toBe('received');
    expect(citizenView.json().data.history).toHaveLength(1);
  });

  it('routes SOS to the officer queue, blocks duplicate sends and records acknowledgment', async () => {
    app = await buildApp(new FixtureDirectoryRepository());
    const body = {
      idempotencyKey: 'sos-test-key-0001', contactPhone: '0911222333', category: 'security', note: 'Yêu cầu hỗ trợ kiểm thử.',
      latitude: 11.944, longitude: 108.441, accuracyM: 8, deviceTimestamp: new Date().toISOString(),
    };
    const first = await app.inject({ method: 'POST', url: '/v1/citizen/sos', headers: citizenHeaders, payload: body });
    const repeated = await app.inject({ method: 'POST', url: '/v1/citizen/sos', headers: citizenHeaders, payload: body });
    expect(repeated.json().data.id).toBe(first.json().data.id);
    expect(first.json().data.status).toBe('dispatched');

    const queue = await app.inject({ method: 'GET', url: '/v1/officer/queue?kind=sos', headers: officerHeaders });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().data).toHaveLength(1);
    expect(queue.json().data[0].priority).toBe('critical');

    const acknowledged = await app.inject({
      method: 'POST', url: `/v1/officer/sos/${first.json().data.id}/transitions`, headers: officerHeaders,
      payload: {
        toStatus: 'acknowledged', note: 'CSKV đã xác nhận yêu cầu trên hệ thống local.',
        assignedOfficerId: 'officer-demo-xuan-huong',
      },
    });
    expect(acknowledged.statusCode).toBe(200);
    expect(acknowledged.json().data.status).toBe('acknowledged');
    expect(acknowledged.json().data.assignedOfficer.id).toBe('officer-demo-xuan-huong');
    expect(acknowledged.json().data.history).toHaveLength(3);

    const cancelAfterAcknowledgment = await app.inject({
      method: 'POST', url: `/v1/citizen/sos/${first.json().data.receiptCode}/cancel`, headers: citizenHeaders,
      payload: { note: 'Thử hủy sau khi cán bộ đã xác nhận.' },
    });
    expect(cancelAfterAcknowledgment.statusCode).toBe(409);

    const responding = await app.inject({
      method: 'POST', url: `/v1/officer/sos/${first.json().data.id}/transitions`, headers: officerHeaders,
      payload: { toStatus: 'responding', note: 'Đang triển khai xử lý.', assignedOfficerId: 'officer-demo-xuan-huong' },
    });
    expect(responding.json().data.status).toBe('responding');

    const resolved = await app.inject({
      method: 'POST', url: `/v1/officer/sos/${first.json().data.id}/transitions`, headers: officerHeaders,
      payload: { toStatus: 'resolved', note: 'Đã kiểm tra kết quả và người gửi đã an toàn.' },
    });
    expect(resolved.json().data.status).toBe('resolved');

    const closed = await app.inject({
      method: 'POST', url: `/v1/officer/sos/${first.json().data.id}/transitions`, headers: officerHeaders,
      payload: { toStatus: 'closed', note: 'Đóng hồ sơ sau khi hoàn tất kiểm tra.' },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().data.status).toBe('closed');
    expect(closed.json().data.history).toHaveLength(6);
  });

  it('rejects implausible SOS device data and malformed callback numbers', async () => {
    app = await buildApp(new FixtureDirectoryRepository());
    const base = {
      idempotencyKey: 'sos-validation-0001', contactPhone: '0911222333', category: 'security',
      latitude: 11.944, longitude: 108.441, deviceTimestamp: new Date().toISOString(),
    };

    const badPhone = await app.inject({
      method: 'POST', url: '/v1/citizen/sos', headers: citizenHeaders,
      payload: { ...base, contactPhone: 'abc' },
    });
    expect(badPhone.statusCode).toBe(400);

    const badAccuracy = await app.inject({
      method: 'POST', url: '/v1/citizen/sos', headers: citizenHeaders,
      payload: { ...base, idempotencyKey: 'sos-validation-0002', accuracyM: 100_000 },
    });
    expect(badAccuracy.statusCode).toBe(400);

    const staleTimestamp = await app.inject({
      method: 'POST', url: '/v1/citizen/sos', headers: citizenHeaders,
      payload: { ...base, idempotencyKey: 'sos-validation-0003', deviceTimestamp: '2000-01-01T00:00:00.000Z' },
    });
    expect(staleTimestamp.statusCode).toBe(400);
  });

  it('requires an operational note and stronger evidence for terminal transitions', async () => {
    app = await buildApp(new FixtureDirectoryRepository());
    const created = await app.inject({
      method: 'POST', url: '/v1/citizen/incidents', headers: citizenHeaders,
      payload: {
        clientRequestId: 'request-note-policy-0001', category: 'security',
        summary: 'Kiểm thử quy tắc ghi chú nghiệp vụ',
        description: 'Hồ sơ kiểm thử độ dài ghi chú khi tiếp nhận và ghi nhận kết quả xử lý.',
        latitude: 11.944, longitude: 108.441,
        attachments: incidentAttachments,
      },
    });
    const id = created.json().data.id as string;

    const tooShort = await app.inject({
      method: 'POST', url: `/v1/officer/incidents/${id}/transitions`, headers: officerHeaders,
      payload: { toStatus: 'received', note: 'Đã nhận' },
    });
    expect(tooShort.statusCode).toBe(400);

    const received = await app.inject({
      method: 'POST', url: `/v1/officer/incidents/${id}/transitions`, headers: officerHeaders,
      payload: { toStatus: 'received', note: 'Đã kiểm tra nội dung ban đầu.' },
    });
    expect(received.statusCode).toBe(200);

    const assignToAnotherAccount = await app.inject({
      method: 'POST', url: `/v1/officer/incidents/${id}/transitions`, headers: officerHeaders,
      payload: { toStatus: 'assigned', note: 'Thử phân công hồ sơ cho tài khoản khác.', assignedOfficerId: 'officer-khac' },
    });
    expect(assignToAnotherAccount.statusCode).toBe(403);

    for (const [toStatus, note] of [
      ['assigned', 'CSKV tự nhận hồ sơ để xử lý.'],
      ['processing', 'Đang triển khai biện pháp xử lý.'],
    ]) {
      const response = await app.inject({
        method: 'POST', url: `/v1/officer/incidents/${id}/transitions`, headers: officerHeaders,
        payload: { toStatus, note, assignedOfficerId: toStatus === 'assigned' ? 'officer-demo-xuan-huong' : undefined },
      });
      expect(response.statusCode).toBe(200);
    }

    const weakResult = await app.inject({
      method: 'POST', url: `/v1/officer/incidents/${id}/transitions`, headers: officerHeaders,
      payload: { toStatus: 'resolved', note: 'Đã xử lý xong.' },
    });
    expect(weakResult.statusCode).toBe(400);

    const completeResult = await app.inject({
      method: 'POST', url: `/v1/officer/incidents/${id}/transitions`, headers: officerHeaders,
      payload: { toStatus: 'resolved', note: 'Đã kiểm tra hiện trường và xử lý hoàn tất theo nội dung phản ánh.' },
    });
    expect(completeResult.statusCode).toBe(200);
    const closedByOfficer = await app.inject({
      method: 'POST', url: `/v1/officer/incidents/${id}/transitions`, headers: officerHeaders,
      payload: { toStatus: 'closed', note: 'CSKV Xuân Hương đã rà soát kết quả và trực tiếp đóng hồ sơ pilot.' },
    });
    expect(closedByOfficer.statusCode).toBe(200);
    expect(closedByOfficer.json().data.status).toBe('closed');
  });

  it('exposes the local officer notification endpoint without claiming external dispatch', async () => {
    app = await buildApp(new FixtureDirectoryRepository());
    const response = await app.inject({ method: 'GET', url: '/v1/officer/notifications', headers: officerHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([]);
    expect(response.json().meta.emergencyDispatchConnected).toBe(false);
  });

  it('supports alerts, case collaboration, patrol check-in and shift summaries', async () => {
    app = await buildApp(new FixtureDirectoryRepository());
    const created = await app.inject({
      method: 'POST', url: '/v1/citizen/incidents', headers: citizenHeaders,
      payload: {
        clientRequestId: 'request-extended-0001', category: 'traffic',
        summary: 'Phản ánh kiểm thử trao đổi hai chiều',
        description: 'Nội dung đủ dài để kiểm tra trao đổi và tệp bổ sung trong hồ sơ.',
        latitude: 11.944, longitude: 108.441, attachments: incidentAttachments,
      },
    });
    const incident = created.json().data;

    const officerMessage = await app.inject({
      method: 'POST', url: `/v1/officer/incidents/${incident.id}/messages`, headers: officerHeaders,
      payload: { message: 'Vui lòng bổ sung thêm ảnh tổng thể.', requestMedia: true },
    });
    expect(officerMessage.statusCode).toBe(201);
    const citizenMessages = await app.inject({ method: 'GET', url: `/v1/citizen/incidents/${incident.receiptCode}/messages`, headers: citizenHeaders });
    expect(citizenMessages.json().data[0]).toMatchObject({ requestMedia: true, authorRole: 'officer' });

    const supplement = await app.inject({
      method: 'POST', url: `/v1/citizen/incidents/${incident.receiptCode}/attachments`, headers: citizenHeaders,
      payload: { attachment: { fileName: 'bo-sung.webp', mimeType: 'image/webp', sizeBytes: 12, dataBase64: 'UklGRi4uLi5XRUJQ' } },
    });
    expect(supplement.statusCode).toBe(201);
    expect(supplement.json().data.purpose).toBe('supplemental');
    const content = await app.inject({ method: 'GET', url: `/v1/citizen/incidents/${incident.receiptCode}/attachments/${supplement.json().data.id}/content`, headers: citizenHeaders });
    expect(content.statusCode).toBe(200);
    expect(content.rawPayload.toString()).toBe('RIFF....WEBP');

    const ratingBeforeResult = await app.inject({
      method: 'POST', url: `/v1/citizen/incidents/${incident.receiptCode}/rating`, headers: citizenHeaders,
      payload: { score: 5, comment: 'Kiểm thử điều kiện đánh giá.' },
    });
    expect(ratingBeforeResult.statusCode).toBe(409);

    for (const [toStatus, note, assignedOfficerId] of [
      ['received', 'CSKV đã tiếp nhận hồ sơ để kiểm tra.', undefined],
      ['assigned', 'CSKV Xuân Hương tự nhận hồ sơ.', 'officer-demo-xuan-huong'],
      ['processing', 'Đang xác minh và xử lý nội dung phản ánh.', undefined],
      ['resolved', 'Đã kiểm tra hiện trường và hoàn tất xử lý phản ánh của người dân.', undefined],
    ] as const) {
      const transition = await app.inject({
        method: 'POST', url: `/v1/officer/incidents/${incident.id}/transitions`, headers: officerHeaders,
        payload: { toStatus, note, assignedOfficerId },
      });
      expect(transition.statusCode).toBe(200);
    }
    const rating = await app.inject({
      method: 'POST', url: `/v1/citizen/incidents/${incident.receiptCode}/rating`, headers: citizenHeaders,
      payload: { score: 5, comment: 'Cán bộ phản hồi rõ ràng và xử lý đúng nội dung.' },
    });
    expect(rating.statusCode).toBe(201);
    const officerIncident = await app.inject({ method: 'GET', url: `/v1/officer/incidents/${incident.id}`, headers: officerHeaders });
    expect(officerIncident.json().data.satisfactionRating).toMatchObject({ score: 5, comment: 'Cán bộ phản hồi rõ ràng và xử lý đúng nội dung.' });

    const alert = await app.inject({
      method: 'POST', url: '/v1/officer/alerts', headers: officerHeaders,
      payload: { title: 'Cảnh báo kiểm thử', category: 'traffic', riskLevel: 'info', summary: 'Nội dung cảnh báo kiểm thử hợp lệ.', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString() },
    });
    expect(alert.statusCode).toBe(201);
    const publicAlerts = await app.inject({ method: 'GET', url: '/v1/public/alerts?areaCode=DEMO-DA-LAT' });
    expect(publicAlerts.json().data).toHaveLength(1);
    // Không truyền areaCode: trả cảnh báo toàn tỉnh để người dân thấy ngay khi chưa chọn địa bàn.
    const provinceAlerts = await app.inject({ method: 'GET', url: '/v1/public/alerts' });
    expect(provinceAlerts.statusCode).toBe(200);
    expect(provinceAlerts.json().data.length).toBeGreaterThanOrEqual(1);
    expect((await app.inject({ method: 'GET', url: '/v1/public/alerts?areaCode=x' })).statusCode).toBe(400);
    // Lưu trữ hồ sơ đã đóng và báo cáo chi tiết theo kỳ.
    const archive = await app.inject({ method: 'GET', url: '/v1/officer/archive', headers: officerHeaders });
    expect(archive.statusCode).toBe(200);
    expect(Array.isArray(archive.json().data)).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/v1/officer/archive?from=not-a-date', headers: officerHeaders })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/v1/officer/archive' })).statusCode).toBe(401);
    const reportCases = await app.inject({ method: 'GET', url: '/v1/officer/reports/cases?period=month', headers: officerHeaders });
    expect(reportCases.statusCode).toBe(200);
    expect(Array.isArray(reportCases.json().data)).toBe(true);

    const patrol = await app.inject({
      method: 'POST', url: '/v1/officer/patrols', headers: officerHeaders,
      payload: { title: 'Tuần tra khu trung tâm', routeNote: 'Kiểm tra tuyến chính.', scheduledAt: new Date().toISOString() },
    });
    const patrolId = patrol.json().data.id;
    expect((await app.inject({ method: 'POST', url: `/v1/officer/patrols/${patrolId}/actions`, headers: officerHeaders, payload: { action: 'start' } })).statusCode).toBe(200);
    const checkin = await app.inject({ method: 'POST', url: `/v1/officer/patrols/${patrolId}/actions`, headers: officerHeaders, payload: { action: 'checkin', latitude: 11.944, longitude: 108.441 } });
    expect(checkin.json().data.lastCheckin.latitude).toBe(11.944);
    const shift = await app.inject({ method: 'GET', url: '/v1/officer/shift-summary', headers: officerHeaders });
    expect(shift.statusCode).toBe(200);
    expect(shift.json().data.incidentsReceived).toBe(1);
  });

  it('publishes an alert with a map position that citizens can read, and rejects half a coordinate', async () => {
    app = await buildApp(new FixtureDirectoryRepository(), { corsOrigin: 'http://localhost:5173', allowTestAuthHeaders: true });
    const base = { title: 'Ngập cục bộ đường chính', category: 'weather', riskLevel: 'medium', summary: 'Tránh đoạn đường ngập, đi theo biển chỉ dẫn.', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString() };
    const created = await app.inject({ method: 'POST', url: '/v1/officer/alerts', headers: officerHeaders, payload: { ...base, latitude: 11.944, longitude: 108.441 } });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ latitude: 11.944, longitude: 108.441 });
    const listed = await app.inject({ method: 'GET', url: `/v1/public/alerts?areaCode=${created.json().data.areaCode}` });
    expect(listed.json().data[0]).toMatchObject({ title: 'Ngập cục bộ đường chính', latitude: 11.944, longitude: 108.441 });
    const half = await app.inject({ method: 'POST', url: '/v1/officer/alerts', headers: officerHeaders, payload: { ...base, latitude: 11.944 } });
    expect(half.statusCode).toBe(400);
    const outOfRange = await app.inject({ method: 'POST', url: '/v1/officer/alerts', headers: officerHeaders, payload: { ...base, latitude: 95, longitude: 108.441 } });
    expect(outOfRange.statusCode).toBe(400);
  });

  it('uses signed HttpOnly sessions for both pilot roles and ignores forged headers', async () => {
    app = await buildApp(new FixtureDirectoryRepository(), {
      corsOrigin: 'http://localhost:5173',
      officerSessionSecret: 'test-session-secret-with-more-than-32-characters',
      officerCredentials: [
        { username: 'cskv.test', password: 'Officer@Test2026', actorId: 'officer-demo-xuan-huong' },
      ],
      citizenSessionSecret: 'test-citizen-secret-with-more-than-32-characters',
      citizenCredentials: [{ username: 'citizen.test', password: 'Citizen@Test2026', citizenId: 'citizen-test-001', displayName: 'Người dân kiểm thử' }],
    });

    const forgedHeader = await app.inject({
      method: 'GET', url: '/v1/officer/queue', headers: { 'x-officer-id': 'officer-demo-xuan-huong' },
    });
    expect(forgedHeader.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST', url: '/v1/auth/officer/login',
      payload: { username: 'cskv.test', password: 'Officer@Test2026' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().data.actorType).toBe('officer');
    const cookie = login.headers['set-cookie'];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');

    const session = await app.inject({ method: 'GET', url: '/v1/auth/officer/session', headers: { cookie } });
    expect(session.statusCode).toBe(200);
    expect(session.json().data.id).toBe('officer-demo-xuan-huong');

    const queue = await app.inject({ method: 'GET', url: '/v1/officer/queue', headers: { cookie } });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().meta.authentication).toBe('http_only_session');

    const protectedWithoutCitizenSession = await app.inject({ method: 'GET', url: '/v1/citizen/incidents' });
    expect(protectedWithoutCitizenSession.statusCode).toBe(401);
    const citizenLogin = await app.inject({ method: 'POST', url: '/v1/auth/citizen/login', payload: { username: 'citizen.test', password: 'Citizen@Test2026' } });
    expect(citizenLogin.statusCode).toBe(200);
    const citizenCookie = citizenLogin.headers['set-cookie'];
    expect(citizenCookie).toContain('HttpOnly');
    const citizenSession = await app.inject({ method: 'GET', url: '/v1/auth/citizen/session', headers: { cookie: citizenCookie } });
    expect(citizenSession.json().data.displayName).toBe('Người dân kiểm thử');
    const citizenIncidents = await app.inject({ method: 'GET', url: '/v1/citizen/incidents', headers: { cookie: citizenCookie } });
    expect(citizenIncidents.statusCode).toBe(200);
  });

  it('registers, persists and authenticates a citizen account without claiming VNeID verification', async () => {
    const repository = new FixtureDirectoryRepository();
    app = await buildApp(repository, {
      corsOrigin: 'http://localhost:5173',
      citizenSessionSecret: 'test-citizen-secret-with-more-than-32-characters',
    });

    const weakPassword = await app.inject({
      method: 'POST', url: '/v1/auth/citizen/register',
      payload: { username: '0912345678', displayName: 'Nguyễn Văn An', password: '12345678' },
    });
    expect(weakPassword.statusCode).toBe(400);
    expect(weakPassword.json().error).toBe('WEAK_PASSWORD');

    const registered = await app.inject({
      method: 'POST', url: '/v1/auth/citizen/register',
      payload: { username: '0912345678', displayName: 'Nguyễn Văn An', password: 'CongDan@2026' },
    });
    expect(registered.statusCode).toBe(201);
    expect(registered.json().data.displayName).toBe('Nguyễn Văn An');
    expect(registered.headers['set-cookie']).toContain('HttpOnly');

    const duplicate = await app.inject({
      method: 'POST', url: '/v1/auth/citizen/register',
      payload: { username: '0912345678', displayName: 'Tên khác', password: 'CongDan@2026' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toBe('ACCOUNT_EXISTS');

    const login = await app.inject({
      method: 'POST', url: '/v1/auth/citizen/login',
      payload: { username: '0912345678', password: 'CongDan@2026' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().data.displayName).toBe('Nguyễn Văn An');

    const badLogin = await app.inject({
      method: 'POST', url: '/v1/auth/citizen/login',
      payload: { username: '0912345678', password: 'khong-dung-2026' },
    });
    expect(badLogin.statusCode).toBe(401);
  });
});
