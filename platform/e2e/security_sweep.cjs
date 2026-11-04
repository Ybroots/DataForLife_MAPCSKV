// CHỈ chạy trên API cục bộ (127.0.0.1). Từ chối mọi địa chỉ khác để không tấn công nhầm hệ thống thật.
{ const h = new URL(process.env.B || 'http://127.0.0.1:3001').hostname; if (!['127.0.0.1','localhost'].includes(h)) { console.error('Chỉ chạy trên localhost'); process.exit(2); } }
const B = process.env.B || 'http://127.0.0.1:3001';
const results = []; let n5xx = 0;
function rec(name, ok, detail) { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  -> ' + detail : '')); }
class Jar { constructor(){this.c={};} set(res){ for (const s of res.headers.getSetCookie?.()||[]) { const [kv]=s.split(';'); const i=kv.indexOf('='); const k=kv.slice(0,i), v=kv.slice(i+1); if(/Max-Age=0|Expires=Thu, 01 Jan 1970/.test(s)||v==='') delete this.c[k]; else this.c[k]=v; } } h(){ return Object.entries(this.c).map(([k,v])=>k+'='+v).join('; '); } }
async function call(method, path, { jar, body, raw, headers = {}, ct } = {}) {
  const h = { Accept: 'application/json', ...headers };
  if (jar && jar.h()) h.Cookie = jar.h();
  let payload;
  if (raw !== undefined) { payload = raw; h['Content-Type'] = ct || 'application/json'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await fetch(B + path, { method, headers: h, body: payload, redirect: 'manual' });
  if (jar) jar.set(res);
  let data = null; const t = await res.text(); try { data = JSON.parse(t); } catch { data = t; }
  if (res.status >= 500) { n5xx++; console.log('   !! 5xx', method, path, res.status, String(t).slice(0,120)); }
  return { status: res.status, data, headers: res.headers };
}
const phone = () => '09' + String(Math.floor(Math.random()*1e8)).padStart(8,'0');
const PASS = 'Matkhau12345';
(async () => {
  // ---------- 1. Unauthenticated access to protected routes
  const prot = [
    ['GET','/v1/citizen/incidents'],['POST','/v1/citizen/incidents'],['GET','/v1/citizen/incidents/PA-X'],['GET','/v1/citizen/incidents/PA-X/messages'],
    ['POST','/v1/citizen/incidents/PA-X/messages'],['POST','/v1/citizen/incidents/PA-X/attachments'],['POST','/v1/citizen/incidents/PA-X/withdraw'],
    ['POST','/v1/citizen/incidents/PA-X/rating'],['GET','/v1/citizen/sos'],['POST','/v1/citizen/sos'],['GET','/v1/citizen/sos/SOS-X'],['POST','/v1/citizen/sos/SOS-X/cancel'],
    ['POST','/v1/citizen/sos/SOS-X/safe'],['GET','/v1/citizen/notifications'],['POST','/v1/citizen/notifications/read'],['GET','/v1/citizen/app-rating'],['POST','/v1/citizen/app-rating'],
    ['POST','/v1/citizen/incident-draft'],
    ['GET','/v1/officer/queue'],['GET','/v1/officer/actors'],['GET','/v1/officer/incidents/x'],['POST','/v1/officer/incidents/x/transitions'],['POST','/v1/officer/incidents/x/messages'],
    ['GET','/v1/officer/incidents/x/messages'],['POST','/v1/officer/incidents/x/category'],['GET','/v1/officer/incidents/x/duplicates'],['POST','/v1/officer/incidents/x/duplicate-of'],
    ['GET','/v1/officer/incidents/x/ai-review'],['POST','/v1/officer/incidents/x/ai-review'],['GET','/v1/officer/sos/x'],['POST','/v1/officer/sos/x/transitions'],['POST','/v1/officer/alerts'],
    ['GET','/v1/officer/patrols'],['POST','/v1/officer/patrols'],['GET','/v1/officer/shift-summary'],['POST','/v1/officer/shift-reports'],['GET','/v1/officer/statistics'],
    ['GET','/v1/officer/map-points'],['POST','/v1/officer/map-points'],['DELETE','/v1/officer/map-points/x'],['PATCH','/v1/officer/map-points/x'],['GET','/v1/officer/notifications'],
    ['GET','/v1/officer/incidents/x/attachments/y/content'],['GET','/v1/citizen/incidents/PA-X/attachments/y/content'],
  ];
  let bad = [];
  for (const [m,p] of prot) { const r = await call(m,p,{ body: m==='GET'||m==='DELETE'?undefined:{} }); if (![401,403].includes(r.status)) bad.push(`${m} ${p}=${r.status}`); }
  rec('1. Route cần đăng nhập đều chặn khi chưa đăng nhập ('+prot.length+' route)', bad.length===0, bad.join('; '));

  // ---------- accounts
  const A = new Jar(), Bj = new Jar(), O = new Jar();
  const pa = phone(), pb = phone();
  let r = await call('POST','/v1/auth/citizen/register',{ jar:A, body:{ username:pa, displayName:'Nguoi A', password:PASS }}); rec('2a. Đăng ký người dân A', r.status===201, r.status);
  r = await call('POST','/v1/auth/citizen/register',{ jar:Bj, body:{ username:pb, displayName:'Nguoi B', password:PASS }}); rec('2b. Đăng ký người dân B', r.status===201, r.status);
  r = await call('POST','/v1/auth/officer/login',{ jar:O, body:{ username:'cskv.test', password:'TestOfficerPass-2026!' }}); rec('2c. Cán bộ đăng nhập', r.status===200, r.status);
  const cookieHdr = (await fetch(B+'/v1/auth/citizen/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:pa,password:PASS})})).headers.get('set-cookie');
  rec('2d. Cookie phiên có HttpOnly + SameSite', /HttpOnly/.test(cookieHdr)&&/SameSite=(Lax|Strict)/.test(cookieHdr), cookieHdr.replace(/=[^;]{20,}/,'=<token>'));

  // ---------- 3. Citizen cookie on officer routes / officer cookie on citizen routes
  bad = [];
  for (const [m,p] of prot.filter(x=>x[1].includes('/officer/'))) { const r = await call(m,p,{ jar:A, body: m==='GET'||m==='DELETE'?undefined:{} }); if (![401,403].includes(r.status)) bad.push(`${m} ${p}=${r.status}`); }
  rec('3a. Người dân không gọi được route cán bộ', bad.length===0, bad.join('; '));
  bad = [];
  for (const [m,p] of [['GET','/v1/citizen/incidents'],['GET','/v1/citizen/sos'],['POST','/v1/citizen/incidents']]) { const r = await call(m,p,{ jar:O, body: m==='GET'?undefined:{} }); if (![401,403].includes(r.status)) bad.push(`${m} ${p}=${r.status}`); }
  rec('3b. Cán bộ không dùng route người dân', bad.length===0, bad.join('; '));

  // ---------- 4. Tạo phản ánh (không ảnh), IDOR
  const inc = { clientRequestId: crypto.randomUUID(), category:'public_order', summary:'Kiểm thử bảo mật phản ánh', description:'Mô tả kiểm thử đủ dài để qua kiểm tra hợp lệ.', latitude:11.9404, longitude:108.4583, accuracyM:20, attachments:[] };
  r = await call('POST','/v1/citizen/incidents',{ jar:A, body:inc }); rec('4a. Gửi phản ánh không ảnh', r.status===201||r.status===200, r.status+' '+JSON.stringify(r.data).slice(0,100));
  const receipt = r.data?.data?.receiptCode;
  r = await call('POST','/v1/citizen/incidents',{ jar:A, body:inc }); rec('4b. Gửi lại cùng clientRequestId không tạo bản sao (idempotent)', r.status<300 && r.data?.data?.receiptCode===receipt, r.status);
  r = await call('GET','/v1/citizen/incidents/'+receipt,{ jar:A }); rec('4c. Chủ xem được phản ánh', r.status===200, r.status);
  bad = [];
  for (const [m,p,b] of [['GET',`/v1/citizen/incidents/${receipt}`],['GET',`/v1/citizen/incidents/${receipt}/messages`],['POST',`/v1/citizen/incidents/${receipt}/messages`,{message:'xam nhap'}],['POST',`/v1/citizen/incidents/${receipt}/withdraw`,{}],['POST',`/v1/citizen/incidents/${receipt}/rating`,{score:1,comment:'x'}]]) {
    const x = await call(m,p,{ jar:Bj, body:b }); if (![403,404].includes(x.status)) bad.push(`${m} ${p}=${x.status}`); }
  rec('4d. IDOR: người dân B không đụng được phản ánh của A', bad.length===0, bad.join('; '));
  r = await call('GET','/v1/citizen/incidents',{ jar:Bj }); rec('4e. Danh sách của B không lẫn phản ánh của A', r.status===200 && !JSON.stringify(r.data).includes(receipt), '');

  // ---------- 5. SOS
  const sos = { idempotencyKey:crypto.randomUUID(), contactPhone:'0911222333', category:'security', note:'test', latitude:11.9404, longitude:108.4583, accuracyM:15, deviceTimestamp:new Date().toISOString() };
  r = await call('POST','/v1/citizen/sos',{ jar:A, body:sos }); rec('5a. Gửi SOS', r.status<300, r.status+' '+JSON.stringify(r.data).slice(0,120));
  const sosReceipt = r.data?.data?.receiptCode;
  r = await call('GET','/v1/citizen/sos/'+sosReceipt,{ jar:Bj }); rec('5b. IDOR SOS: B không xem được SOS của A', [403,404].includes(r.status), r.status);
  r = await call('POST','/v1/citizen/sos/'+sosReceipt+'/cancel',{ jar:Bj, body:{note:'x'} }); rec('5c. B không hủy được SOS của A', [403,404].includes(r.status), r.status);
  let codes = []; for (let i=0;i<8;i++){ const x = await call('POST','/v1/citizen/sos',{ jar:A, body:{...sos, idempotencyKey: crypto.randomUUID()} }); codes.push(x.status); }
  rec('5d. Giới hạn spam SOS theo tài khoản (5/10 phút)', codes.includes(429), codes.join(','));

  // ---------- 6. Brute force
  const victim = phone(); await call('POST','/v1/auth/citizen/register',{ body:{ username:victim, displayName:'Nan nhan', password:PASS }});
  codes = []; for (let i=0;i<8;i++){ const x = await call('POST','/v1/auth/citizen/login',{ body:{ username:victim, password:'SaiMatKhau'+i+'zz' }}); codes.push(x.status); }
  rec('6a. Brute-force đăng nhập bị khóa sau ~5 lần', codes.includes(429), codes.join(','));
  const x6 = await call('POST','/v1/auth/citizen/login',{ body:{ username:victim, password:PASS }}); rec('6b. Đang bị khóa thì mật khẩu đúng cũng chưa vào được (hoặc 429)', x6.status===429, x6.status);
  // đăng ký hàng loạt
  codes = []; for (let i=0;i<8;i++){ const x = await call('POST','/v1/auth/citizen/register',{ body:{ username:phone(), displayName:'Spam', password:PASS }}); codes.push(x.status); }
  rec('6c. Đăng ký hàng loạt bị giới hạn theo IP', codes.includes(429), codes.join(','));

  // ---------- 7. Injection / input lạ
  const evil = ["' OR 1=1 --", "'; DROP TABLE incidents;--", '%', '_', '../../etc/passwd', '<script>alert(1)</script>', '\u0000', 'a'.repeat(5000), '${7*7}', '{{7*7}}'];
  bad = [];
  for (const e of evil) {
    for (const p of ['/v1/areas?query=','/v1/lookup/by-code/','/v1/public/alerts?areaCode=']) { const x = await call('GET', p + encodeURIComponent(e)); if (x.status>=500) bad.push(p+e.slice(0,20)+'='+x.status); }
    const x = await call('GET','/v1/citizen/incidents/'+encodeURIComponent(e),{ jar:A }); if (x.status>=500) bad.push('incident/'+e.slice(0,20)+'='+x.status);
  }
  for (const [la,lo] of [['NaN','1'],['1e999','1'],['11','abc'],['-91','0'],['','']]) { const x = await call('GET',`/v1/lookup/by-location?lat=${la}&lng=${lo}`); if (x.status>=500) bad.push('loc '+la+','+lo+'='+x.status); }
  rec('7a. SQL/XSS/path payload trên GET không gây 5xx', bad.length===0, bad.join('; '));
  r = await call('GET','/v1/areas?query='+encodeURIComponent("' OR 1=1 --")); rec('7b. SQLi không trả về toàn bộ dữ liệu', r.status===200 && (r.data.data||[]).length<=1, JSON.stringify(r.data).slice(0,80));
  // body bất thường
  bad = [];
  const bodies = [['invalid json','{bad',  'application/json'],['array','[]','application/json'],['null','null','application/json'],['number','123','application/json'],['proto','{"__proto__":{"admin":true},"constructor":{"prototype":{"x":1}}}','application/json'],['text/plain','hello','text/plain'],['empty','','application/json'],['form','a=b','application/x-www-form-urlencoded']];
  for (const path of ['/v1/citizen/incidents','/v1/citizen/sos','/v1/auth/citizen/login','/v1/auth/citizen/register','/v1/auth/officer/login','/v1/citizen/incident-draft','/v1/assistant/query']) {
    for (const [nm,raw,ct] of bodies) { const x = await call('POST',path,{ jar:A, raw, ct }); if (x.status>=500) bad.push(path+' '+nm+'='+x.status); }
  }
  rec('7c. Body JSON lỗi/lạ không gây 5xx ('+7*bodies.length+' ca)', bad.length===0, bad.join('; '));
  // trường kiểu sai
  bad = [];
  const weird = [{summary:{a:1}},{summary:['x']},{latitude:'abc',longitude:{}},{description:'x'.repeat(200000)},{clientRequestId:123},{attachments:'x'},{attachments:[null]},{attachments:[{}]},{category:['security']}];
  for (const w of weird) { const x = await call('POST','/v1/citizen/incidents',{ jar:A, body:{...inc, clientRequestId:crypto.randomUUID(), ...w} }); if (x.status>=500 || x.status<400) bad.push(JSON.stringify(w).slice(0,40)+'='+x.status); }
  rec('7d. Phản ánh với trường sai kiểu/quá dài bị từ chối 4xx', bad.length===0, bad.join('; '));

  // ---------- 8. Upload
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4N8AAAAASUVORK5CYII=','base64');
  const up = (name,mime,buf)=>({ fileName:name, mimeType:mime, sizeBytes:buf.length, dataBase64:buf.toString('base64') });
  r = await call('POST',`/v1/citizen/incidents/${receipt}/attachments`,{ jar:A, body:{ attachment: up('ok.png','image/png',png) }}); rec('8a. Upload ảnh hợp lệ', r.status<300, r.status+' '+JSON.stringify(r.data).slice(0,80));
  const attId = r.data?.data?.id;
  const html = Buffer.from('<html><script>alert(document.cookie)</script></html>');
  r = await call('POST',`/v1/citizen/incidents/${receipt}/attachments`,{ jar:A, body:{ attachment: up('evil.png','image/png',html) }}); const fakeAcc = r.status<300;
  rec('8b. Upload file HTML giả danh PNG bị từ chối (kiểm tra nội dung thật)', !fakeAcc, 'status '+r.status);
  if (fakeAcc) { const id = r.data?.data?.id; const g = await call('GET',`/v1/citizen/incidents/${receipt}/attachments/${id}/content`,{ jar:A }); console.log('   content-type served:', g.headers.get('content-type'), 'nosniff:', g.headers.get('x-content-type-options'), 'disposition:', g.headers.get('content-disposition')); }
  r = await call('POST',`/v1/citizen/incidents/${receipt}/attachments`,{ jar:A, body:{ attachment: up('x.exe','application/x-msdownload',png) }}); rec('8c. MIME lạ bị từ chối', r.status===400||r.status===422, r.status);
  const big = Buffer.alloc(6*1024*1024, 1); r = await call('POST',`/v1/citizen/incidents/${receipt}/attachments`,{ jar:A, body:{ attachment: up('big.png','image/png',big) }}); rec('8d. Ảnh >5MB bị từ chối', r.status>=400&&r.status<500, r.status);
  const huge = Buffer.alloc(40*1024*1024, 65); r = await call('POST',`/v1/citizen/incidents/${receipt}/attachments`,{ jar:A, raw: JSON.stringify({attachment:{fileName:'h.png',mimeType:'image/png',sizeBytes:huge.length,dataBase64:huge.toString('base64')}}) }); rec('8e. Body >30MB bị chặn (413)', r.status===413, r.status);
  if (attId) { const g = await call('GET',`/v1/citizen/incidents/${receipt}/attachments/${attId}/content`,{ jar:A }); rec('8f. Tải lại ảnh đúng content-type + nosniff', g.status===200 && /image\/png/.test(g.headers.get('content-type')||'') && g.headers.get('x-content-type-options')==='nosniff', g.headers.get('content-type'));
    const g2 = await call('GET',`/v1/citizen/incidents/${receipt}/attachments/${attId}/content`,{ jar:Bj }); rec('8g. B không tải được ảnh của A', [403,404].includes(g2.status), g2.status);
    const g3 = await call('GET',`/v1/citizen/incidents/${receipt}/attachments/${attId}/content`); rec('8h. Người lạ không tải được ảnh', [401,403].includes(g3.status), g3.status); }

  // ---------- 9. Token giả
  const tamper = new Jar(); tamper.c = { ...A.c }; const k = Object.keys(tamper.c)[0]; tamper.c[k] = tamper.c[k].slice(0,-3) + 'AAA';
  r = await call('GET','/v1/auth/citizen/session',{ jar:tamper }); rec('9a. Cookie bị sửa không được chấp nhận', r.status===401, r.status);
  r = await call('GET','/v1/citizen/incidents',{ headers:{ 'x-citizen-id':'citizen-test','x-test-actor-id':'x' } }); rec('9b. Header giả danh (x-citizen-id) không có tác dụng', [401,403].includes(r.status), r.status);
  r = await call('GET','/v1/officer/queue',{ headers:{ 'x-actor-id':'officer-1','x-officer-id':'officer-1','x-test-actor-id':'officer-1' } }); rec('9c. Header giả danh cán bộ không có tác dụng', [401,403].includes(r.status), r.status);
  // phiên người dân đã logout
  const old = new Jar(); old.c = { ...A.c }; await call('POST','/v1/auth/citizen/logout',{ jar:A });
  r = await call('GET','/v1/auth/citizen/session',{ jar:old }); console.log('   (thông tin) token cũ sau khi đăng xuất còn dùng được? status', r.status);

  // ---------- 10. CORS / headers
  r = await call('GET','/v1/hotlines',{ headers:{ Origin:'https://evil.example' } }); const acao = r.headers.get('access-control-allow-origin');
  rec('10a. CORS không cho origin lạ', acao!=='*' && acao!=='https://evil.example', String(acao));
  r = await call('OPTIONS','/v1/citizen/incidents',{ headers:{ Origin:'https://evil.example','Access-Control-Request-Method':'POST' } }); rec('10b. Preflight từ origin lạ không được phép', r.headers.get('access-control-allow-origin')!=='https://evil.example', String(r.headers.get('access-control-allow-origin')));
  r = await call('GET','/health'); rec('10c. Header an toàn cơ bản', r.headers.get('x-content-type-options')==='nosniff', '');
  r = await call('GET','/health'); rec('10d. Không lộ phiên bản máy chủ (x-powered-by)', !r.headers.get('x-powered-by'), String(r.headers.get('x-powered-by')));
  r = await call('GET','/v1/nope'); rec('10e. 404 không lộ stack trace', r.status===404 && !/at \w+ \(|node_modules/.test(JSON.stringify(r.data)), JSON.stringify(r.data).slice(0,80));
  r = await call('GET','/health'); console.log('   /health lộ releaseValidation:', JSON.stringify(r.data));

  // ---------- 11. Cán bộ: đầu vào sai
  bad = [];
  for (const [m,p,b] of [['POST','/v1/officer/incidents/nope/transitions',{status:'processing'}],['POST','/v1/officer/incidents/nope/messages',{message:'x'}],['POST','/v1/officer/alerts',{}],['POST','/v1/officer/patrols',{}],['POST','/v1/officer/map-points',{}],['PATCH','/v1/officer/map-points/nope',{}],['DELETE','/v1/officer/map-points/nope'],['GET','/v1/officer/statistics?period=zzz&date=bad'],['GET','/v1/officer/queue?kind=zzz&status=zzz&limit=-5'],['POST','/v1/officer/sos/nope/transitions',{status:'x'}],['POST','/v1/officer/incidents/nope/duplicate-of',{}],['POST','/v1/officer/shift-reports',{}],['POST','/v1/officer/patrols/nope/actions',{}]]) {
    const x = await call(m,p,{ jar:O, body:b }); if (x.status>=500) bad.push(m+' '+p+'='+x.status); }
  rec('11. Route cán bộ với đầu vào sai không gây 5xx', bad.length===0, bad.join('; '));

  console.log('\nTổng 5xx quan sát được:', n5xx, '| FAIL:', results.filter(x=>!x.ok).length, '/', results.length);
})().catch(e=>{console.error(e);process.exit(1)});
