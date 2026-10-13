// UserPromptSubmit hook: records the time of Wahb's latest prompt in
// last-activity.json at the repo root. SAO reads it for AFK detection.
// Writes nothing else and never blocks the prompt.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const now = new Date();
try {
  writeFileSync(
    join(root, 'last-activity.json'),
    JSON.stringify({ lastActivity: now.toISOString(), epochMs: now.getTime(), source: 'prompt' }) + '\n',
  );
} catch {
  // A failed write must not stop the prompt.
}
process.exit(0);
