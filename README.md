# Indian Legal Translator — Deployment Guide

## What this app does
- Translates scanned and digital PDFs, .docx, and .txt files from any Indian language to English
- Supreme Court formatting: Times New Roman 12pt, 1.5 line spacing, justified
- Page range selector for large documents
- Downloads as a properly formatted .docx

---

## Deploy to Vercel (one-time setup, ~5 minutes)

### Prerequisites
- Node.js installed ✓
- Free Vercel account at https://vercel.com
- Anthropic API key from https://console.anthropic.com

### Step 1 — Install Vercel CLI
Open your terminal (Command Prompt or PowerShell on Windows) and run:
```
npm install -g vercel
```

### Step 2 — Go into the project folder
```
cd translator-app
```

### Step 3 — Install dependencies
```
npm install
```

### Step 4 — Deploy
```
vercel
```
- It will ask you to log in — follow the browser prompt
- When asked "Set up and deploy?" → press Enter (yes)
- When asked project name → press Enter (use default)
- When asked about the directory → press Enter
- When asked to override settings → type N and press Enter

### Step 5 — Set your Anthropic API key as an environment variable
```
vercel env add ANTHROPIC_API_KEY
```
Paste your API key when prompted. Select all environments (Production, Preview, Development).

### Step 6 — Redeploy with the env variable
```
vercel --prod
```

Vercel will give you a URL like `https://your-app-name.vercel.app` — open that in any browser.

---

## Using the app
1. Enter your Anthropic API key in the key field and click Save
2. Upload your file (.pdf, .docx, or .txt)
3. Select the source language (or leave on Auto-detect)
4. For PDFs, set the page range you want to translate
5. Click Translate
6. Download the .docx

## Notes
- The API key is entered in the browser and sent directly to the Anthropic API — it is not stored on the server
- Scanned PDFs are processed entirely on the server — no browser OCR
- For documents over 10 pages, translate in batches using the page range selector
- Each page costs roughly $0.01–0.03 depending on content density
