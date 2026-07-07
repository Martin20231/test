const SKIP_LINE =
  /^(pfand|summe|gesamt|bar\b|rückgeld|mwst|ust|coupon|steuer|sepa|enthaltene|zwischensumme|kdnr|tel\.|straße|ust-id|uhr|datum|bon|kasse|filiale|bedient|tse|signatur|visa|ec-karte|karte|gegeben|wechselgeld|netto\s*€|brutto|positionen|artikel|kundenbeleg|beleg|nr\.|ustid|ust-id)/i;

const STORE_DETECTORS = [
  { name: 'Netto', re: /\bnetto\b/i },
  { name: 'EDEKA', re: /\bedeka\b/i },
  { name: 'ROSSMANN', re: /\brossmann\b/i },
  { name: 'REWE', re: /\brewe\b/i },
  { name: 'Lidl', re: /\blidl\b/i },
  { name: 'Aldi', re: /\baldi\b/i },
];

function parsePrice(str) {
  const n = parseFloat(str.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function detectStore(text) {
  for (const { name, re } of STORE_DETECTORS) {
    if (re.test(text)) return name;
  }
  return null;
}

export function parseReceiptLines(text) {
  const items = [];
  const seen = new Set();

  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/\s+/g, ' ');
    if (!line || line.length < 4) continue;
    if (SKIP_LINE.test(line)) continue;
    if (/^\d{2}[./]\d{2}[./]\d{2,4}/.test(line)) continue;
    if (/^\d{2}:\d{2}/.test(line)) continue;

    if (/\d+\s*x\s+\d+[,.]\d{2}\s*=/.test(line)) {
      const qtyLine = line.match(/^(.+?)\s+\d+\s*x\s+\d+[,.]\d{2}\s*=\s*(\d+[,.]\d{2})/i);
      if (qtyLine) {
        const name = qtyLine[1].trim();
        const price = parsePrice(qtyLine[2]);
        if (name.length >= 2 && price > 0 && price < 500) {
          const key = `${name}|${price}`;
          if (!seen.has(key)) {
            seen.add(key);
            items.push({ ocr_name: name, price });
          }
        }
      }
      continue;
    }

    // "NAME ... 1,59" or "EAN NAME 2,25 A"
    const endPrice = line.match(/(.+?)\s+(\d+[,.]\d{2})\s*[*ABW]?\s*$/i);
    if (endPrice) {
      let name = endPrice[1].replace(/^\d{13}\s*/, '').trim();
      name = name.replace(/\s+\d+\s*x\s*$/i, '').trim();
      const price = parsePrice(endPrice[2]);
      if (name.length >= 2 && price > 0 && price < 500) {
        const key = `${name}|${price}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push({ ocr_name: name, price });
        }
      }
      continue;
    }
  }

  return items;
}

function tokenize(str) {
  return str
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

export function matchToCatalog(ocrItems, products) {
  return ocrItems.map((item) => {
    const tokens = tokenize(item.ocr_name);
    let best = null;
    let bestScore = 0;

    for (const product of products) {
      const pLower = product.name.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (pLower.includes(token)) score += token.length;
      }
      if (product.brand && tokens.some((t) => product.brand.toLowerCase().includes(t))) {
        score += 3;
      }
      if (score > bestScore) {
        bestScore = score;
        best = product;
      }
    }

    const matched = bestScore >= 4;
    return {
      ocr_name: item.ocr_name,
      price: item.price,
      product_id: matched ? best.id : null,
      product_name: matched ? best.name : item.ocr_name,
      image_url: matched ? best.image_url : null,
      matched,
    };
  });
}

async function loadTesseract() {
  return import('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/+esm');
}

export async function analyzeReceipt(imageDataUrl, products, onProgress) {
  const { createWorker } = await loadTesseract();
  const worker = await createWorker('deu', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(m.progress ?? 0);
      }
    },
  });

  try {
    const {
      data: { text },
    } = await worker.recognize(imageDataUrl);
    const detectedStore = detectStore(text);
    const lines = parseReceiptLines(text);
    const items = matchToCatalog(lines, products);

    return {
      text,
      detectedStore,
      items,
      lineCount: lines.length,
    };
  } finally {
    await worker.terminate();
  }
}
