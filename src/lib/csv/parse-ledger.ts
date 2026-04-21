import Papa from "papaparse";

export type ParsedEntry = {
  date: string;
  description: string;
  amount: string;
  account: string | null;
  reference: string | null;
  rawRow: Record<string, string>;
};

export type ParseError = {
  rowNumber: number;
  reason: string;
  rawRow: Record<string, string>;
};

type Field = "date" | "description" | "amount" | "debit" | "credit" | "account" | "reference";

const HEADER_ALIASES: Record<Field, string[]> = {
  date: ["date", "transaction date", "posting date"],
  description: ["description", "memo", "name", "payee"],
  amount: ["amount"],
  debit: ["debit"],
  credit: ["credit"],
  account: ["account", "category", "account name"],
  reference: ["reference", "check #", "num", "invoice #"],
};

function normalize(header: string): string {
  return header.trim().toLowerCase();
}

function buildHeaderMap(headers: string[]): Partial<Record<Field, string>> {
  const map: Partial<Record<Field, string>> = {};
  for (const header of headers) {
    const n = normalize(header);
    for (const field of Object.keys(HEADER_ALIASES) as Field[]) {
      if (HEADER_ALIASES[field].includes(n) && !map[field]) {
        map[field] = header;
      }
    }
  }
  return map;
}

function parseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // ISO-ish (YYYY-MM-DD or YYYY/MM/DD)
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(trimmed);
  if (iso) {
    const [, y, m, d] = iso;
    return buildDate(Number(y), Number(m), Number(d));
  }

  // US-style MM/DD/YYYY or MM-DD-YYYY (also accepts 2-digit year)
  const us = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/.exec(trimmed);
  if (us) {
    const [, m, d, yRaw] = us;
    const y = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
    return buildDate(y, Number(m), Number(d));
  }

  return null;
}

function buildDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d
    .toString()
    .padStart(2, "0")}`;
}

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Strip currency symbols, commas, and surrounding parens (accounting negative).
  const negative = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed
    .replace(/[()$\s]/g, "")
    .replace(/,/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function toFixed2(n: number): string {
  return n.toFixed(2);
}

export function parseLedgerCsv(fileText: string): {
  entries: ParsedEntry[];
  errors: ParseError[];
} {
  const entries: ParsedEntry[] = [];
  const errors: ParseError[] = [];

  const result = Papa.parse<Record<string, string>>(fileText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const headers = result.meta.fields ?? [];
  const headerMap = buildHeaderMap(headers);

  const rows = result.data;
  rows.forEach((row, idx) => {
    const rowNumber = idx + 2; // account for header row
    const dateHeader = headerMap.date;
    const descHeader = headerMap.description;
    const amountHeader = headerMap.amount;
    const debitHeader = headerMap.debit;
    const creditHeader = headerMap.credit;
    const accountHeader = headerMap.account;
    const referenceHeader = headerMap.reference;

    if (!dateHeader || !descHeader) {
      errors.push({
        rowNumber,
        reason: "Missing required column (date or description)",
        rawRow: row,
      });
      return;
    }

    const rawDate = row[dateHeader] ?? "";
    const rawDesc = row[descHeader] ?? "";
    const date = parseDate(rawDate);
    const description = rawDesc.trim();

    if (!date) {
      errors.push({
        rowNumber,
        reason: `Unparseable date: "${rawDate}"`,
        rawRow: row,
      });
      return;
    }
    if (!description) {
      errors.push({ rowNumber, reason: "Missing description", rawRow: row });
      return;
    }

    let amount: number | null = null;
    if (debitHeader && creditHeader) {
      const debit = parseAmount(row[debitHeader] ?? "") ?? 0;
      const credit = parseAmount(row[creditHeader] ?? "") ?? 0;
      if (
        (row[debitHeader] ?? "").trim() === "" &&
        (row[creditHeader] ?? "").trim() === ""
      ) {
        amount = null;
      } else {
        amount = debit - credit;
      }
    } else if (amountHeader) {
      amount = parseAmount(row[amountHeader] ?? "");
    } else if (debitHeader) {
      amount = parseAmount(row[debitHeader] ?? "");
    } else if (creditHeader) {
      const c = parseAmount(row[creditHeader] ?? "");
      amount = c === null ? null : -c;
    }

    if (amount === null || !Number.isFinite(amount)) {
      errors.push({ rowNumber, reason: "Missing or unparseable amount", rawRow: row });
      return;
    }

    const account = accountHeader ? (row[accountHeader] ?? "").trim() || null : null;
    const reference = referenceHeader
      ? (row[referenceHeader] ?? "").trim() || null
      : null;

    entries.push({
      date,
      description,
      amount: toFixed2(amount),
      account,
      reference,
      rawRow: row,
    });
  });

  return { entries, errors };
}
