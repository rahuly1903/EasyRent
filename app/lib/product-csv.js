const TITLE_HEADERS = new Set(["product title", "title", "product_title"]);
const HANDLE_HEADERS = new Set(["handle", "product handle", "product_handle"]);

export function normalizeProductHandle(value) {
  let text = String(value ?? "").trim();
  if (!text) return "";
  const fromUrl = text.match(/\/products\/([^/?#]+)/i);
  if (fromUrl) {
    try {
      text = decodeURIComponent(fromUrl[1]);
    } catch {
      text = fromUrl[1];
    }
  }
  text = text.replace(/^\/+|\/+$/g, "").split(/[?#]/)[0];
  if (text.includes("/")) text = text.split("/").filter(Boolean).pop() || "";
  try {
    text = decodeURIComponent(text);
  } catch {
    // Keep the raw handle when it is not encoded.
  }
  return text.trim().toLowerCase();
}

export function parseProductCsv(text) {
  const rows = parseCsv(String(text || "").replace(/^\uFEFF/, ""));
  const useful = rows.filter((row) => row.some((cell) => String(cell || "").trim()));
  if (!useful.length) return [];

  const header = useful[0].map((cell) => String(cell || "").trim().toLowerCase());
  const titleIndex = header.findIndex((cell) => TITLE_HEADERS.has(cell));
  const handleIndex = header.findIndex((cell) => HANDLE_HEADERS.has(cell));
  const hasHeader = titleIndex >= 0 && handleIndex >= 0;
  const dataRows = hasHeader ? useful.slice(1) : useful;
  const titleCol = hasHeader ? titleIndex : 0;
  const handleCol = hasHeader ? handleIndex : 1;

  const products = [];
  for (const row of dataRows) {
    const title = String(row[titleCol] || "").trim();
    const handle = normalizeProductHandle(row[handleCol]);
    if (!title && !handle) continue;
    products.push({ title, handle });
  }
  return products;
}

export function linkedProductsToCsv(rows) {
  const lines = ["product title,handle"];
  for (const row of rows || []) {
    const title = row.productTitle || row.title || "";
    const handle = row.productHandle || row.handle || "";
    lines.push(`${csvCell(title)},${csvCell(handle)}`);
  }
  return `${lines.join("\r\n")}\r\n`;
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char === "\r") continue;
    cell += char;
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
