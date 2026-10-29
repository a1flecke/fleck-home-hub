const required = ['security', 'checks', 'browser'];
let needs;
try {
  needs = JSON.parse(process.env.GATE_NEEDS_JSON ?? '');
  if (!needs || typeof needs !== 'object' || Array.isArray(needs)) throw new Error('expected an object');
} catch {
  console.error('Merge gate: invalid or missing job results');
  process.exit(1);
}
const failures = required.filter(name => needs[name]?.result !== 'success');
if (failures.length) {
  console.error(`Merge gate: required jobs did not succeed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('All required jobs succeeded');
