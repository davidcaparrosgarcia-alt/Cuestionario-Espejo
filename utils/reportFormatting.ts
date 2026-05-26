export type ReportBlock = {
  text: string;
  isTitle: boolean;
  isSubTitle?: boolean;
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractHeadingsFromPrompt = (clinicalPrompt?: string): string[] => {
  if (!clinicalPrompt) return [];
  const lines = clinicalPrompt.split('\n');
  const headings: string[] = [];

  for (const line of lines) {
    const clean = line.trim();
    if (clean.length < 8 || clean.length > 100) continue;
    if (clean.endsWith('.')) continue;
    if (clean.startsWith('NO ') || clean.startsWith('SI ') || clean.startsWith('USA ')) continue;

    const letters = clean.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, "");
    const isMostlyUppercase = clean === clean.toUpperCase() && letters.length >= 6;
    const wordCount = clean.split(/\s+/).length;

    if (isMostlyUppercase && wordCount >= 2) {
      headings.push(clean);
    }
  }

  return headings;
};

export const escapeHtml = (value: string) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export const normalizeGeneratedClinicalReport = (
  text?: string,
  clinicalPrompt?: string
): string => {
  if (!text) return "";

  let normalized = String(text)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const headings = extractHeadingsFromPrompt(clinicalPrompt);
  const sortedHeadings = [...headings].sort((a, b) => b.length - a.length);

  for (const heading of sortedHeadings) {
    const re = new RegExp(`\\s*${escapeRegExp(heading)}\\s*[\\.:：]?\\s*`, "gi");
    // Replace with double line breaks for all headings.
    normalized = normalized.replace(re, `\n\n${heading}\n\n`);
  }

  // Separate numbered lists
  normalized = normalized.replace(/([^\n])\s+(\d{1,2}\.\s+)/g, "$1\n\n$2");
  normalized = normalized.replace(/(\d{1,2}\.\s+[^\\n]+?)(?=\s+\d{1,2}\.\s+)/g, "$1\n\n");

  normalized = normalized.replace(/\n{3,}/g, "\n\n").trim();
  return normalized;
};

export const formatGeneratedReportForDisplay = (
  text?: string,
  clinicalPrompt?: string
): ReportBlock[] => {
  if (!text) return [];

  let normalized = normalizeGeneratedClinicalReport(text, clinicalPrompt);

  const rawBlocks = normalized
    .split(/\n{2,}/)
    .map(b => b.trim())
    .filter(Boolean);

  const headings = extractHeadingsFromPrompt(clinicalPrompt);
  const sortedHeadings = [...headings].sort((a, b) => b.length - a.length);

  const blocks: ReportBlock[] = [];

  for (const block of rawBlocks) {
    const blockUpper = block.toUpperCase();
    
    let isHeading = false;
    for (const heading of sortedHeadings) {
        if (blockUpper === heading.toUpperCase()) {
            blocks.push({ text: block, isTitle: true });
            isHeading = true;
            break;
        }
    }
    
    if (isHeading) continue;

    let matchedHeadingStart = false;
    for (const heading of sortedHeadings) {
      if (blockUpper.startsWith(heading.toUpperCase() + "\n")) {
        blocks.push({ text: block.substring(0, heading.length).trim(), isTitle: true });
        const remaining = block.substring(heading.length).trim();
        if (remaining) blocks.push({ text: remaining, isTitle: false });
        matchedHeadingStart = true;
        break;
      }
    }
    
    if (matchedHeadingStart) continue;

    // Fallback: heuristic detection if no exact match
    const isMostlyUppercase = block === block.toUpperCase() && block.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, "").length >= 6;
    if (isMostlyUppercase && block.length <= 100 && block.split(/\s+/).length >= 2 && !block.endsWith('.')) {
         blocks.push({ text: block, isTitle: true });
         continue;
    }

    blocks.push({ text: block, isTitle: false });
  }

  return blocks;
};
