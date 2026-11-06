import { createHmac } from 'node:crypto';
let schemaPromise;
async function ensureRateLimitSchema(query){
  if(!schemaPromise)schemaPromise=(async()=>{
    await query(`CREATE TABLE IF NOT EXISTS security_rate_buckets(bucket_key TEXT PRIMARY KEY,timestamps_json TEXT NOT NULL DEFAULT '[]',updated_at BIGINT NOT NULL DEFAULT 0)`);
    await query('CREATE INDEX IF NOT EXISTS security_rate_buckets_updated_idx ON security_rate_buckets(updated_at)');
  })().catch(e=>{schemaPromise=null;throw e});
  await schemaPromise;
}
export function resolveClientIp(headers={},remoteAddress=''){
  const real=headers['x-real-ip'];
  if(typeof real==='string'&&real.trim()&&real.length<=128)return real.trim();
  const forwarded=headers['x-forwarded-for'];
  if(typeof forwarded==='string'&&forwarded.length<=1024){const chain=forwarded.split(',').map(v=>v.trim()).filter(Boolean);if(chain.length)return chain.at(-1).slice(0,128);}
  return String(remoteAddress||'unknown').slice(0,128);
}
export function activeTimestamps(value,now,windowMs){
  try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed.filter(v=>Number.isSafeInteger(v)&&v>now-windowMs&&v<=now):[]}catch{return []}
}
export function retryAfterSeconds(timestamps,now,windowMs,maximum){
  return timestamps.length<maximum?0:Math.max(1,Math.ceil((timestamps[0]+windowMs-now)/1000));
}
export async function consumeRateLimit({req,key,maximum,windowMs,secret,query,withTransaction}){
  if(!Number.isInteger(maximum)||maximum<1||!Number.isInteger(windowMs)||windowMs<1)throw new TypeError('Parâmetros inválidos para o limitador.');
  if(typeof withTransaction!=='function')throw new TypeError('O limitador exige transação PostgreSQL.');
  await ensureRateLimitSchema(query);
  const now=Date.now(),ip=resolveClientIp(req?.headers||{},req?.socket?.remoteAddress);
  const bucket=createHmac('sha256',secret||'menuza-rate-limit-fallback').update(String(key)+':'+ip).digest('hex');
  return withTransaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[bucket]);
    const row=await client.query('SELECT timestamps_json FROM security_rate_buckets WHERE bucket_key=$1 FOR UPDATE',[bucket]);
    const timestamps=activeTimestamps(row.rows[0]?.timestamps_json,now,windowMs),retry=retryAfterSeconds(timestamps,now,windowMs,maximum);
    if(retry)return retry;
    timestamps.push(now);
    await client.query(`INSERT INTO security_rate_buckets(bucket_key,timestamps_json,updated_at) VALUES($1,$2,$3)
      ON CONFLICT(bucket_key) DO UPDATE SET timestamps_json=EXCLUDED.timestamps_json,updated_at=EXCLUDED.updated_at`,[bucket,JSON.stringify(timestamps),now]);
    return 0;
  });
}
