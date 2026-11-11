// Try multiple mppx install locations (npm ERESOLVE conflicts in /tmp — pitfall #35)
let mppx;
const paths = [
  '/tmp/mppx_temp/node_modules/mppx',
  '/tmp/node_modules/mppx',
];
if (process.argv[4]) paths.unshift(process.argv[4]); // explicit path from CLI

for (const p of paths) {
  try { mppx = require(p); break; } catch (e) { /* try next */ }
}
if (!mppx) {
  console.error('mppx not found. Install: mkdir -p /tmp/mppx_temp && cd /tmp/mppx_temp && npm init -y && npm install mppx');
  process.exit(1);
}

const { Challenge, Credential } = mppx;

// Serialize MPP Stripe SPT credential for autonomous payment.
// Usage: node mppx_gen.js "<www-authenticate header>" "<spt_token>" [mppx_module_path]
// Output: "Payment eyJjaGFsbGVuZ2UiOnsi..." (full Authorization header value)

const challengeHeader = process.argv[2];
const spt = process.argv[3];

if (!challengeHeader || !spt) {
  console.error('Usage: node mppx_gen.js "<www-authenticate>" "<spt_...>" [mppx_path]');
  process.exit(1);
}

const mockResponse = {
  status: 402,
  headers: new Map([
    ['WWW-Authenticate', challengeHeader]
  ])
};

const challenges = Challenge.fromResponseList(mockResponse);
const stripeChallenge = challenges.find(c => c.method === 'stripe');

if (!stripeChallenge) {
  console.error('No stripe challenge found in header');
  process.exit(1);
}

const credential = Credential.from({
  challenge: stripeChallenge,
  payload: { spt: spt }
});

console.log(Credential.serialize(credential));
