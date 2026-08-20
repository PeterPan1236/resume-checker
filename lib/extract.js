import mammoth from 'mammoth';
import { extractText as pdfText, getDocumentProxy } from 'unpdf';

const MAX_CHARS = 60000;

export class ExtractError extends Error {}

function normalise(raw) {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS);
}

function detectKind(name, mime) {
  const ext = (name || '').toLowerCase().split('.').pop();
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return 'docx';
  }
  if (ext === 'doc' || mime === 'application/msword') return 'doc';
  if (['txt', 'md', 'text'].includes(ext) || (mime || '').startsWith('text/')) return 'txt';
  return 'unknown';
}

// Legacy binary .doc: no clean parser available, so pull the readable runs out of
// the raw bytes. Good enough to analyse, but flagged as lossy for the caller.
function scrapeLegacyDoc(buffer) {
  const text = buffer.toString('latin1');
  const runs = text.match(/[\x20-\x7E\n]{6,}/g) || [];
  return runs
    .filter((r) => /[a-zA-Z]{3,}/.test(r) && !/^[A-Za-z]:\\|Microsoft|Word\.Document|Root Entry/.test(r))
    .join('\n');
}

export async function extractText(buffer, filename, mimetype) {
  const kind = detectKind(filename, mimetype);
  let text = '';
  let pages = null;
  const warnings = [];

  switch (kind) {
    case 'pdf': {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const data = await pdfText(pdf, { mergePages: true });
      text = data.text || '';
      pages = data.totalPages || null;
      if (normalise(text).length < 200) {
        warnings.push(
          'Almost no text came out of this PDF. It is probably a scan or image export — ATS parsers will read it the same way, i.e. as blank. Re-export as a text PDF.'
        );
      }
      break;
    }
    case 'docx': {
      // mammoth's browser build (what bundles into the Worker) only accepts
      // arrayBuffer; the Node build accepts it too, so use it on both.
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      const res = await mammoth.extractRawText({ arrayBuffer });
      text = res.value || '';
      break;
    }
    case 'doc': {
      text = scrapeLegacyDoc(buffer);
      warnings.push(
        'Legacy .doc format was read with a lossy fallback; some text may be missing. Save as .docx or PDF for an accurate check.'
      );
      break;
    }
    case 'txt':
      text = buffer.toString('utf8');
      break;
    default:
      throw new ExtractError('Unsupported file type. Upload PDF, DOCX, DOC, or TXT.');
  }

  const clean = normalise(text);
  if (clean.length < 80) {
    throw new ExtractError(
      'Could not read enough text from this file. If it is a scanned PDF, export a text-based version and try again.'
    );
  }
  return { text: clean, kind, pages, warnings };
}
