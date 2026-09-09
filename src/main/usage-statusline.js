// Optional Claude status-line feed. Stores only quota windows, no transcript,
// credentials, cwd or session identifiers. The user installs it explicitly.
const fs = require('node:fs');
const path = require('node:path');
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; if (input.length > 1024 * 1024) process.exit(1); });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input), directory = process.argv[2];
    if (!directory || !path.isAbsolute(directory)) return;
    const limits = {};
    for (const key of ['five_hour', 'seven_day', 'spend_limit']) {
      const w = data.rate_limits?.[key];
      if (w && typeof w.used_percentage === 'number' && Number.isFinite(w.used_percentage)) limits[key] = { used_percentage: w.used_percentage, resets_at: w.resets_at };
    }
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, 'claude.json'), tmp = file + '.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify({ at: Date.now(), rate_limits: limits }), { mode: 0o600 }); fs.renameSync(tmp, file);
    process.stdout.write(Object.entries(limits).map(([key, w]) => key.replaceAll('_', ' ') + ': ' + Math.max(0, 100 - w.used_percentage).toFixed(0) + '% left').join(' · ') || 'Claude');
  } catch (_) { process.stdout.write('Claude'); }
});
