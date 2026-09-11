// An unavailable or incomplete audit is a failed release gate, never a pass.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function assessAudit(result) {
  if (result.error || result.signal || result.status !== 0) return { ok: false, reason: 'audit failed or reported vulnerabilities' };
  let report;
  try { report = JSON.parse(result.stdout); } catch { return { ok: false, reason: 'audit did not return JSON' }; }
  const counts = report?.metadata?.vulnerabilities;
  if (report.error || !counts || !['info', 'low', 'moderate', 'high', 'critical', 'total'].every(k => counts[k] === 0)
      || !report.vulnerabilities || Object.keys(report.vulnerabilities).length) {
    return { ok: false, reason: 'audit is incomplete or has unresolved findings' };
  }
  return { ok: true };
}

export function checkSecurity({ cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), run = spawnSync } = {}) {
  let passed = true;
  for (const [label, flags] of [['all dependencies', []], ['runtime dependencies', ['--omit=dev']]]) {
    const result = run('npm', ['audit', '--json', ...flags], { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    const verdict = assessAudit(result);
    console.log(`${verdict.ok ? 'PASS' : 'FAIL'}: ${label}: ${verdict.ok ? 'zero known vulnerabilities' : verdict.reason}`);
    passed &&= verdict.ok;
  }
  return passed;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = checkSecurity() ? 0 : 1;
