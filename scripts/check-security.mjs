// An unavailable or incomplete audit is a failed release gate, never a pass.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

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

export function assessElectron(locked, versions, latest) {
  const parse = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
  const current = parse(locked), newest = parse(latest);
  const branch = (Array.isArray(versions) ? versions : [versions]).map(parse).filter(v => v && v[0] === current?.[0]);
  if (!current || !newest || !branch.length) return { ok: false, reason: 'Electron release metadata is incomplete' };
  branch.sort((a, b) => b[1] - a[1] || b[2] - a[2]);
  if (current[0] > newest[0] || current[0] < newest[0] - 2) return { ok: false, reason: 'Electron major is outside the latest three stable releases' };
  if (locked !== branch[0].join('.')) return { ok: false, reason: `Electron ${locked} is behind its current ${current[0]}.x update (${branch[0].join('.')})` };
  return { ok: true };
}

export function checkSecurity({ cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), run = spawnSync, electronVersion } = {}) {
  let passed = true;
  for (const [label, flags] of [['all dependencies', []], ['runtime dependencies', ['--omit=dev']]]) {
    const result = run('npm', ['audit', '--json', ...flags], { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    const verdict = assessAudit(result);
    console.log(`${verdict.ok ? 'PASS' : 'FAIL'}: ${label}: ${verdict.ok ? 'zero known vulnerabilities' : verdict.reason}`);
    passed &&= verdict.ok;
  }
  try {
    const locked = electronVersion || JSON.parse(fs.readFileSync(path.join(cwd, 'package-lock.json'), 'utf8')).packages['node_modules/electron'].version;
    if (!/^\d+\.\d+\.\d+$/.test(locked)) throw Error('Invalid locked Electron version');
    const view = spec => {
      const result = run('npm', ['view', spec, 'version', '--json'], { cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
      if (result.error || result.signal || result.status !== 0) throw Error('Electron release metadata is unavailable');
      return JSON.parse(result.stdout);
    };
    const verdict = assessElectron(locked, view('electron@' + locked.split('.')[0]), view('electron'));
    console.log(`${verdict.ok ? 'PASS' : 'FAIL'}: ${verdict.ok ? 'Electron ' + locked + ' is current within a supported major' : verdict.reason}`);
    passed &&= verdict.ok;
  } catch {
    console.log('FAIL: Electron release metadata could not be verified'); passed = false;
  }
  return passed;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = checkSecurity() ? 0 : 1;
