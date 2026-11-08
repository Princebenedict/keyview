// TEE attestation. Returns a real TDX quote only when the server runs inside
// a dstack guest (for example a Phala Cloud CVM), where the guest agent
// listens on a unix socket. Anywhere else it says so plainly.
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';

const SOCKET = process.env.DSTACK_SOCKET || '/var/run/dstack.sock';

function post(socketPath, pathName, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: pathName, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => (res.statusCode === 200 ? resolve(JSON.parse(raw)) : reject(new Error(`dstack ${res.statusCode}`))));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('dstack timeout')));
    req.end(JSON.stringify(body));
  });
}

// reportData binds the quote to this deployment: the master-key fingerprint and the contract.
export async function getAttestation({ master, contract }) {
  const fingerprint = crypto.createHash('sha256').update('keyview-fp').update(master).digest('hex');
  if (!fs.existsSync(SOCKET)) {
    return { available: false, reason: 'Not running inside a TEE (no dstack socket). Trade encryption keys are held by an ordinary process.' };
  }
  const reportData = crypto.createHash('sha512').update(`keyview:${contract || 'dry-run'}:${fingerprint}`).digest('hex');
  try {
    const quote = await post(SOCKET, '/GetQuote', { report_data: reportData });
    return { available: true, keyFingerprint: fingerprint, reportData, contract: contract || null, quote };
  } catch (e) {
    return { available: false, reason: `TEE socket present but quote failed: ${e.message}` };
  }
}
