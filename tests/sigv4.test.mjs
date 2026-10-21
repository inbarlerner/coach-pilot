// Verifies the presigner against AWS's published SigV4 query-string example
// (Amazon S3 docs: "Authenticating Requests: Using Query Parameters").
import { presign } from '../functions/_lib/sigv4.js';

const url = await presign({
  method: 'GET',
  host: 'examplebucket.s3.amazonaws.com',
  path: '/test.txt',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  expires: 86400,
  date: new Date('2013-05-24T00:00:00Z'),
});
const expected = 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404';
const got = new URL(url).searchParams.get('X-Amz-Signature');
if (got !== expected) { console.error('FAIL sigv4', got); process.exit(1); }
console.log('PASS: SigV4 presign matches AWS reference signature');
