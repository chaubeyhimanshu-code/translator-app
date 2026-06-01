const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");

export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { fileData, fileType } = req.body;
    if (!fileData) return res.status(400).json({ error: "No file data provided" });

    if (fileType === "pdf") {
      const buffer = Buffer.from(fileData, "base64");
      const pdf = await pdfjs.getDocument({ data: buffer, disableWorker: true }).promise;
      return res.json({ pages: pdf.numPages });
    }

    // For txt/docx — single "page" conceptually
    return res.json({ pages: 1 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
