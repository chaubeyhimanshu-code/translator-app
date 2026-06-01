import formidable from 'formidable';
import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';
import mammoth from 'mammoth';
 
export const config = {
  api: { bodyParser: false },
  // Long translations need time. 300s requires a Pro plan / Fluid compute.
  // On Hobby this is capped much lower and long docs WILL time out.
  maxDuration: 300,
};
 
// Override with the CLAUDE_MODEL env var. claude-opus-4-8 is current and supports
// PDF/vision. claude-sonnet-4-6 is much cheaper for bulk translation.
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';
 
// Output token cap. A long document can exceed this and get truncated — for real
// 100-page jobs, translate in chunks instead of one call (see notes in chat).
const MAX_TOKENS = 32000;
 
const SYSTEM_PROMPT = `You are a professional legal translator. You translate Indian-language court and legal documents into English for filing before the Supreme Court of India.
 
Rules:
- Translate faithfully and completely. Do not summarise, omit, paraphrase loosely, or add commentary.
- Preserve all legal terminology, party names, case numbers, dates, statutory references, and citations exactly.
- Use standard English transliteration for proper nouns; retain the original term in square brackets only where ambiguity would otherwise change meaning.
- Preserve the paragraph structure and any numbering of the source document.
- Write in clear, formal English suitable for a court record.
- Output ONLY the translated English text. No preamble, no notes, no markdown formatting.`;
 
function firstFile(files) {
  const f = files.file;
  if (!f) return null;
  return Array.isArray(f) ? f[0] : f;
}
function firstField(fields, key) {
  const v = fields[key];
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}
function textFrom(message) {
  return (message.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}
 
async function translatePdf(client, buf, startPage, endPage) {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const total = src.getPageCount();
  const s = Math.max(1, startPage || 1);
  const e = Math.min(total, endPage || total);
  if (s > e) throw new Error(`Invalid page range: start ${s} is after end ${e}.`);
  if (e - s + 1 > 100) {
    throw new Error(
      `Selected ${e - s + 1} pages. A single request supports at most 100 PDF pages. Narrow the range.`
    );
  }
 
  // Slice out only the requested pages so we send the model exactly that range.
  const out = await PDFDocument.create();
  const indices = [];
  for (let i = s - 1; i <= e - 1; i++) indices.push(i);
  const copied = await out.copyPages(src, indices);
  copied.forEach((p) => out.addPage(p));
  const bytes = await out.save();
  const b64 = Buffer.from(bytes).toString('base64');
 
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: b64 },
          },
          {
            type: 'text',
            text: `Translate this document (pages ${s} to ${e}) into English following the rules. It may be a scanned image PDF; read it with vision if there is no text layer.`,
          },
        ],
      },
    ],
  });
  return textFrom(message);
}
 
async function translateText(client, text) {
  if (!text || !text.trim()) throw new Error('Document contained no extractable text.');
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Translate the following document into English following the rules.\n\n---\n${text}`,
      },
    ],
  });
  return textFrom(message);
}
 
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in the environment.' });
    return;
  }
 
  let tmpPath = null;
  try {
    const form = formidable({
      maxFileSize: 25 * 1024 * 1024,
      keepExtensions: true,
    });
    const [fields, files] = await form.parse(req);
 
    const file = firstFile(files);
    if (!file) {
      res.status(400).json({ error: 'No file uploaded (expected field name "file").' });
      return;
    }
    tmpPath = file.filepath;
 
    const startPage = parseInt(firstField(fields, 'startPage') || '1', 10) || 1;
    const endRaw = parseInt(firstField(fields, 'endPage') || '0', 10);
    const endPage = endRaw > 0 ? endRaw : undefined;
 
    const name = (file.originalFilename || '').toLowerCase();
    const buf = fs.readFileSync(file.filepath);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
 
    let translation;
    if (name.endsWith('.pdf')) {
      translation = await translatePdf(client, buf, startPage, endPage);
    } else if (name.endsWith('.docx')) {
      const { value } = await mammoth.extractRawText({ buffer: buf });
      translation = await translateText(client, value);
    } else if (name.endsWith('.txt')) {
      translation = await translateText(client, buf.toString('utf8'));
    } else {
      res.status(400).json({ error: 'Unsupported file type. Use PDF, DOCX, or TXT.' });
      return;
    }
 
    res.status(200).json({ translation });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Translation failed' });
  } finally {
    if (tmpPath) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}
 
