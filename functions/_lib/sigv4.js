// AWS Signature V4 query-string presigning (works with Cloudflare R2's S3 API).
// Uses WebCrypto only — runs in Cloudflare Workers/Pages Functions and Node 18+.

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}
// RFC 3986 encoding as required by SigV4
const uriEncode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encodePath = (p) => p.split('/').map(uriEncode).join('/');

/**
 * @param {object} o
 * @param {string} o.method  GET | PUT | DELETE
 * @param {string} o.host    e.g. <account>.r2.cloudflarestorage.com
 * @param {string} o.path    e.g. /bucket/videos/uid/file.mp4 (unencoded)
 * @param {string} o.accessKeyId
 * @param {string} o.secretAccessKey
 * @param {string} [o.region='auto']
 * @param {number} [o.expires=900] seconds
 * @param {Object<string,string>} [o.headers] extra headers to sign (lower-case names)
 * @param {Date}   [o.date]
 * @param {Object<string,string>} [o.query] extra query params
 */
export async function presign(o) {
  const region = o.region || 'auto';
  const service = 's3';
  const date = o.date || new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;

  const headers = { host: o.host, ...(o.headers || {}) };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const signedHeaders = names.join(';');
  const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join('');

  const q = {
    ...(o.query || {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${o.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(o.expires || 900),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(q).sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(q[k])}`).join('&');

  const canonicalPath = encodePath(o.path);
  const canonicalRequest = [o.method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonicalRequest)].join('\n');

  let key = await hmac('AWS4' + o.secretAccessKey, day);
  key = await hmac(key, region);
  key = await hmac(key, service);
  key = await hmac(key, 'aws4_request');
  const signature = toHex(await hmac(key, stringToSign));

  return `${o.protocol || 'https'}://${o.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
