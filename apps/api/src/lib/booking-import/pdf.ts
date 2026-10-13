import { extractText, getDocumentProxy } from 'unpdf';

/** The text of a PDF (a ticket or invoice), or null if it has none (a scanned image). */
export const pdfText = async (bytes: Uint8Array): Promise<string | null> => {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return text.trim() || null;
  } catch {
    return null;
  }
};
