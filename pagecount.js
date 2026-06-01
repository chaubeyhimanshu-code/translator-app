export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { fileData } = req.body;
    if (!fileData) return res.status(400).json({ error: "No file data" });
    const buffer = Buffer.from(fileData, "base64");
    const str = buffer.toString("latin1");
    const matches = str.match(/\/Type\s*\/Page[^s]/g);
    const pages = matches ? matches.length : 1;
    return res.json({ pages: Math.max(pages, 1) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };
