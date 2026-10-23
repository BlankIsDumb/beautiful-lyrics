const attr = (node, name) => Array.from(node.attributes || []).find(a => a.localName === name)?.value;
const role = node => attr(node, 'role') || '';
const annotation = node => /translation|roman|transliteration/.test(role(node)) || ['text', 'textContainer'].includes(attr(node, 'ruby'));

export function ttmlTime(value) {
  if (!value) return undefined;
  if (/^\d+(?:\.\d+)?ms$/.test(value)) return parseFloat(value) / 1000;
  if (/^\d+(?:\.\d+)?s$/.test(value)) return parseFloat(value);
  if (/^\d+(?::\d{2}){0,2}(?:\.\d+)?$/.test(value)) return value.split(':').reduce((t, n) => t * 60 + Number(n), 0);
  throw new Error('Unsupported TTML time');
}

// Native DOMParser is bundled with Spotify; XML is read as data, never inserted
// as HTML. Parser injection is only for the Node regression tests.
export function convertAmll(xml, duration, Parser = globalThis.DOMParser) {
  if (xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsupported TTML document');
  const doc = new Parser().parseFromString(xml, 'application/xml');
  if (!doc.documentElement || doc.documentElement.localName !== 'tt' || doc.getElementsByTagName('parsererror').length) throw new Error('Invalid TTML XML');
  const descendants = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
  function interval(node, fallback) {
    const start = ttmlTime(attr(node, 'begin')) ?? fallback?.start;
    const end = ttmlTime(attr(node, 'end')) ?? (attr(node, 'dur') ? start + ttmlTime(attr(node, 'dur')) : fallback?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > duration + 5) throw new Error('Invalid TTML timing for recording');
    return { start, end };
  }
  function vocals(root, fallback) {
    const chunks = [];
    function walk(node, inherited) {
      for (const child of Array.from(node.childNodes || [])) {
        if (child.nodeType === 3) {
          if (child.nodeValue) chunks.push({ text: child.nodeValue, ...inherited });
        } else if (child.nodeType === 1 && !annotation(child) && role(child) !== 'x-bg') {
          walk(child, interval(child, inherited));
        }
      }
    }
    walk(root, interval(root, fallback));
    // Join text nodes sharing one interval, preserving intentional spaces.
    const merged = [];
    for (const chunk of chunks) {
      const prior = merged.at(-1);
      if (prior && prior.start === chunk.start && prior.end === chunk.end) prior.text += chunk.text;
      else merged.push({ ...chunk });
    }
    const syllables = merged.flatMap((c, i) => c.text.trim() ? [{ Text: c.text.trim(), StartTime: c.start, EndTime: c.end,
      IsPartOfWord: !!merged[i + 1] && !/\s$/.test(c.text) && !/^\s/.test(merged[i + 1].text) }] : []);
    if (!syllables.length) return undefined;
    return { StartTime: Math.min(...syllables.map(s => s.StartTime)), EndTime: Math.max(...syllables.map(s => s.EndTime)), Syllables: syllables };
  }
  const content = [];
  let firstAgent;
  for (const p of descendants(doc, 'p')) {
    if (annotation(p)) continue;
    const bounds = interval(p);
    const lead = vocals(p, bounds);
    if (!lead) continue;
    const agent = attr(p, 'agent');
    firstAgent ??= agent;
    const background = descendants(p, 'span').filter(n => role(n) === 'x-bg').map(n => vocals(n, bounds)).filter(Boolean);
    content.push({ Type: 'Vocal', OppositeAligned: !!agent && agent !== firstAgent, Lead: lead, ...(background.length ? { Background: background } : {}) });
  }
  if (!content.length) return undefined;
  content.sort((a, b) => Math.min(a.Lead.StartTime, ...(a.Background || []).map(v => v.StartTime)) - Math.min(b.Lead.StartTime, ...(b.Background || []).map(v => v.StartTime)));
  const all = content.flatMap(g => [g.Lead, ...(g.Background || [])]);
  return { Type: 'Syllable', StartTime: Math.min(...all.map(v => v.StartTime)), EndTime: Math.max(...all.map(v => v.EndTime)), Content: content };
}
