// AI coach text helpers for the browser (no DOM). The server has the same code in
// functions/_lib/ai-coach.js; tests/ai_coach.test.mjs checks the two stay identical.
export const frameLabel = (n) => 'F' + String(n).padStart(2, '0');

// The written analysis as markdown (what a trainee would read next to the video).
const TEXT = {
  he: { id: 'מה זיהינו', conf: 'ביטחון', short: 'בקצרה', good: 'מה עבד טוב', fix: 'מה לשפר', see: 'מה רואים', why: 'למה זה חשוב', todo: 'מה לעשות', frames: 'פריימים', safety: 'בטיחות', cant: 'מה אי אפשר לשפוט מהסרטון', tip: 'טיפ לצילום הבא', ai: 'זה משוב של AI, לא תחליף למאמן.' },
  en: { id: 'What we saw', conf: 'confidence', short: 'In short', good: 'What worked', fix: 'What to improve', see: 'What we see', why: 'Why it matters', todo: 'What to do', frames: 'Frames', safety: 'Safety', cant: "What the video can't show", tip: 'Filming tip', ai: 'This is AI feedback, not a replacement for a coach.' },
};
export function renderText(a, lang = 'he') {
  const T = TEXT[lang] || TEXT.he;
  const L = [];
  L.push(`**${T.id}:** ${a.trick_identified} (${T.conf}: ${a.trick_confidence})`, '', `**${T.short}:** ${a.summary}`, '', `### ${T.good}`);
  (a.strengths || []).forEach((s) => L.push(`- ${s}`));
  L.push('', `### ${T.fix}`);
  (a.fixes || []).forEach((f, i) => L.push(`${i + 1}. **${f.issue}**`, `   - ${T.see}: ${f.what_we_see}`, `   - ${T.why}: ${f.why}`, `   - ${T.todo}: ${f.drill}`, `   - ${T.frames}: ${f.frames}`));
  L.push('', `### ${T.safety}`, a.safety_note || '', '', `### ${T.cant}`);
  (a.cannot_judge || []).forEach((s) => L.push(`- ${s}`));
  L.push('', `### ${T.tip}`, a.filming_tip || '', '', `> ${T.ai}`);
  return L.join('\n');
}
