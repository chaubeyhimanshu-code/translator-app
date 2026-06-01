import formidable from 'formidable';
import fs from 'fs';
import { PDFDocument } from 'pdf-lib';
import mammoth from 'mammoth';
 
// Vercel must NOT pre-parse the body; formidable reads the raw stream.
export const config = {
  api: { bodyParser: false },
};
 
function firstFile(files) {
  const f = files.file;
  if (!f) return null;
  return Array.isArray(f) ? f[0] : f; // formidable v3 returns arrays
}
 
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
 
  let tmpPath = null;
  try {
    const form = formidable({
      maxFileSize: 25 * 1024 * 1024, // 25 MB; see note about Vercel's ~4.5MB body limit
      keepExtensions: true,
    });
 
    const [, files] = await form.parse(req);
    const file = firstFile(files);
    if (!file) {
      res.status(400).json({ error: 'No file uploaded (expected field name "file").' });
      return;
    }
    tmpPath = file.filepath;
 
    const name = (file.originalFilename || '').toLowerCase();
    const buf = fs.readFileSync(file.filepath);
 
    let pageCount = 1;
    let type = 'txt';
    let exact = false;
 
    if (name.endsWith('.pdf')) {
      type = 'pdf';
      exact = true;
      const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
      pageCount = pdf.getPageCount();
    } else if (name.endsWith('.docx')) {
      type = 'docx';
      const { value } = await mammoth.extractRawText({ buffer: buf });
      const words = value.split(/\s+/).filter(Boolean).length;
      pageCount = Math.max(1, Math.ceil(words / 500)); // rough estimate only
    } else {
      type = 'txt';
      const words = buf.toString('utf8').split(/\s+/).filter(Boolean).length;
      pageCount = Math.max(1, Math.ceil(words / 500)); // rough estimate only
    }
 
    res.status(200).json({ pageCount, type, exact });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to read file' });
  } finally {
    if (tmpPath) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}
