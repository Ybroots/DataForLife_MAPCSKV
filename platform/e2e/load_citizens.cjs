// CHỈ chạy trên API cục bộ (127.0.0.1). Từ chối mọi địa chỉ khác để không tấn công nhầm hệ thống thật.
{ const h = new URL(process.env.B || 'http://127.0.0.1:3001').hostname; if (!['127.0.0.1','localhost'].includes(h)) { console.error('Chỉ chạy trên localhost'); process.exit(2); } }
const B=process.env.B||'http://127.0.0.1:3001'; const N=+process.argv[2]||300; const CONC=+process.argv[3]||N;
const lat={}; const errs={}; const t0=Date.now();
const rec=(k,ms,st)=>{(lat[k]??=[]).push(ms); if(st>=400||st===0){(errs[k+' '+st]=(errs[k+' '+st]||0)+1)}};
async function req(k,method,path,{cookie,body,ip}={}){ const s=performance.now(); let st=0,res,txt=''; try{ res=await fetch(B+path,{method,headers:{'content-type':'application/json','x-forwarded-for':ip,...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined}); st=res.status; txt=await res.text(); }catch(e){ st=0; } rec(k,performance.now()-s,st); return {st,res,txt}; }
const png=Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4N8AAAAASUVORK5CYII=','base64'),Buffer.alloc(300*1024,0)]);
async function user(i){
  const ip=`10.${(i>>8)&255}.${i&255}.9`; const phone='09'+String(70000000+i);
  await req('GET overview','GET','/v1/areas/overview',{ip});
  await req('GET search','GET','/v1/areas?query=xuan',{ip});
  await req('GET lookup GPS','GET','/v1/lookup/by-location?lat=11.9404&lng=108.4583',{ip});
  await req('GET hotlines','GET','/v1/hotlines',{ip});
  let r=await req('POST register','POST','/v1/auth/citizen/register',{ip,body:{username:phone,displayName:'Nguoi dan '+i,password:'MatKhau12345'}});
  const cookie=(r.res?.headers.getSetCookie?.()[0]||'').split(';')[0]; if(!cookie) return;
  r=await req('POST login','POST','/v1/auth/citizen/login',{ip,body:{username:phone,password:'MatKhau12345'}});
  const c2=(r.res?.headers.getSetCookie?.()[0]||'').split(';')[0]||cookie;
  const inc={clientRequestId:crypto.randomUUID(),category:'public_order',summary:'Phản ánh tải '+i,description:'Mô tả phản ánh kiểm thử tải số '+i+' đủ dài.',latitude:11.9404,longitude:108.4583,accuracyM:15,attachments:[{fileName:'a.png',mimeType:'image/png',sizeBytes:png.length,dataBase64:png.toString('base64')}]};
  r=await req('POST report (300KB img)','POST','/v1/citizen/incidents',{ip,cookie:c2,body:inc});
  const code=JSON.parse(r.txt||'{}').data?.receiptCode;
  for(let k=0;k<3;k++){ await req('GET my reports','GET','/v1/citizen/incidents',{ip,cookie:c2}); await req('GET notifications','GET','/v1/citizen/notifications',{ip,cookie:c2}); if(code) await req('GET report detail','GET','/v1/citizen/incidents/'+code,{ip,cookie:c2}); }
}
(async()=>{ let next=0; await Promise.all(Array.from({length:CONC},async()=>{ while(next<N){ const i=next++; await user(i); } }));
  const q=(a,p)=>a.sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))].toFixed(0);
  console.log(`${N} người dân, ${CONC} đồng thời, tổng ${((Date.now()-t0)/1000).toFixed(1)}s`);
  for(const [k,a] of Object.entries(lat)) console.log(k.padEnd(24), String(a.length).padStart(5),'req  p50',q(a,.5).padStart(5),'ms  p95',q(a,.95).padStart(5),'ms  max',q(a,1).padStart(5),'ms');
  console.log('Lỗi:', JSON.stringify(errs)); })();
