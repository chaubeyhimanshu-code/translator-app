const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
const { createCanvas } = require("canvas");
const Anthropic = require("@anthropic-ai/sdk");
const JSZip = require("jszip");

export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

const LANGUAGES = {
  auto:       "Auto-detect",
  hi:         "Hindi",
  ta:         "Tamil",
  te:         "Telugu",
  kn:         "Kannada",
  ml:         "Malayalam",
  mr:         "Marathi",
  gu:         "Gujarati",
  bn:         "Bengali",
  or:         "Odia",
  pa:         "Punjabi",
  as:         "Assamese",
  ur:         "Urdu",
  sa:         "Sanskrit",
  kok:        "Konkani",
  sd:         "Sindhi",
  ks:         "Kashmiri",
  mni:        "Manipuri",
  ne:         "Nepali",
  mai:        "Maithili",
  doi:        "Dogri",
  brx:        "Bodo",
  sat:        "Santali",
};

async function extractTextFromDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml").async("string");
  return xml
    .replace(/<w:br[^/]*/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function getPdfPageCount(buffer) {
  const pdf = await pdfjs.getDocument({ data: buffer, disableWorker: true }).promise;
  return pdf.numPages;
}

async function extractPdfTextLayer(buffer) {
  const pdf = await pdfjs.getDocument({ data: buffer, disableWorker: true }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(s => s.str).join(" ") + "\n\n";
  }
  return text.trim();
}

async function rasterisePdfPages(buffer, fromPage, toPage) {
  const pdf = await pdfjs.getDocument({ data: buffer, disableWorker: true }).promise;
  const images = [];

  for (let i = fromPage; i <= toPage; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const base64 = canvas.toBuffer("image/jpeg", { quality: 0.85 }).toString("base64");
    images.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } });
  }
  return images;
}

async function translateWithClaude(apiKey, blocks, langCode, langName) {
  const client = new Anthropic({ apiKey });

  const langInstruction = langCode === "auto"
    ? "The source language may be any Indian language — detect it automatically."
    : `The source language is ${langName}.`;

  const system = `You are a professional legal translator specialising in Indian language to English translation for Indian courts.

${langInstruction}

STRICT RULES — follow every one without exception:
1. Translate the ENTIRE provided content into English. Do not skip, summarise, or paraphrase any portion.
2. Translate WORD-FOR-WORD to the maximum extent grammatically possible. Preserve original sentence structure, paragraph breaks, and numbering.
3. Do NOT add, infer, or fabricate any content not present in the source.
4. Do NOT fill blanks, guess at illegible portions, or complete incomplete sentences.
5. If a word or phrase is unclear or illegible, translate it literally and append [unclear] — do not substitute.
6. Preserve all numbers, dates, case numbers, party names, section references, and proper nouns exactly.
7. Preserve all paragraph breaks and list numbering from the original.
8. If images are provided, read every line of text visible and translate it — do not describe the images.
9. Return ONLY the translated text — no preamble, no explanation, no footnotes.`;

  const userContent = [
    ...blocks,
    { type: "text", text: "Translate all text above to English following the strict rules." },
  ];

  const message = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: userContent }],
  });

  return message.content.filter(b => b.type === "text").map(b => b.text).join("");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { fileData, fileType, fileName, langCode, fromPage, toPage, apiKey } = req.body;

  if (!fileData)  return res.status(400).json({ error: "No file data" });
  if (!apiKey)    return res.status(400).json({ error: "No API key provided" });

  const langName = LANGUAGES[langCode] || "Auto-detect";

  try {
    const buffer = Buffer.from(fileData, "base64");
    let blocks = [];

    if (fileType === "txt") {
      const text = buffer.toString("utf8");
      blocks = [{ type: "text", text }];

    } else if (fileType === "docx") {
      const text = await extractTextFromDocx(buffer);
      blocks = [{ type: "text", text }];

    } else if (fileType === "pdf") {
      // Try text layer first
      const textLayer = await extractPdfTextLayer(buffer);
      const meaningful = textLayer.replace(/\s/g, "").length;

      if (meaningful >= 80) {
        // Digital PDF — use text layer, slice to requested page range if needed
        blocks = [{ type: "text", text: textLayer }];
      } else {
        // Scanned PDF — rasterise requested page range
        const start = parseInt(fromPage) || 1;
        const end   = parseInt(toPage)   || await getPdfPageCount(buffer);
        blocks = await rasterisePdfPages(buffer, start, end);
      }
    } else {
      return res.status(400).json({ error: `Unsupported file type: ${fileType}` });
    }

    const translation = await translateWithClaude(apiKey, blocks, langCode, langName);

    if (!translation.trim()) {
      return res.status(500).json({ error: "Translation returned empty. Please try again." });
    }

    return res.json({ translation, detectedLang: langName });

  } catch (err) {
    console.error("Translate error:", err);
    return res.status(500).json({ error: err.message || "Translation failed" });
  }
}
