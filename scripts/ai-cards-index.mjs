// Rebuilds public/ai-coach/index.json: the list of sports and trick cards the AI coach uses.
// Run after adding, renaming or retitling a card:  node scripts/ai-cards-index.mjs
// (tests/ai_coach.test.mjs fails if the list is out of date.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR = path.join(ROOT, 'public/ai-coach');
const SPORTS = { kitesurf: { he: 'קייטסרפינג (טווין טיפ)', en: 'Kitesurfing (twin tip)' } };

export function buildIndex() {
  return {
    decisions: 'coaching-decisions.md',
    sports: Object.entries(SPORTS).map(([id, name]) => {
      const files = fs.readdirSync(path.join(DIR, 'cards', id)).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
      files.sort((a, b) => (b === 'fundamentals.md') - (a === 'fundamentals.md'));   // fundamentals first
      return {
        id, name,
        cards: files.map((file) => {
          const text = fs.readFileSync(path.join(DIR, 'cards', id, file), 'utf8');
          const h = (text.match(/^#\s+(.+)$/m) || [, file])[1];
          return { file, title: h.replace(/^(Trick\s+)?card:\s*/i, '').replace(/\s+—\s+.*$/, '').trim() };
        }),
      };
    }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(DIR, 'index.json'), JSON.stringify(buildIndex(), null, 2) + '\n');
  console.log('wrote public/ai-coach/index.json');
}
