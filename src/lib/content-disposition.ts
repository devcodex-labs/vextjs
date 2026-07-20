const CONTROL_OR_DEL = /[\u0000-\u001f\u007f]/g;
const PATH_SEPARATOR = /[\\/]/g;
const QUOTED_FALLBACK_UNSAFE = /["\\;]/;
const ASCII_VISIBLE = /^[\u0020-\u007e]$/;

function sanitizeDownloadFilename(filename: string): string {
  const sanitized = filename
    .replace(CONTROL_OR_DEL, "_")
    .replace(PATH_SEPARATOR, "_")
    .trim();

  return sanitized.length > 0 ? sanitized : "download";
}

function toAsciiFallback(filename: string): string {
  let fallback = "";

  for (const char of filename) {
    if (!ASCII_VISIBLE.test(char) || QUOTED_FALLBACK_UNSAFE.test(char)) {
      fallback += "_";
    } else {
      fallback += char;
    }
  }

  return fallback.length > 0 ? fallback : "download";
}

function encodeRfc5987Value(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Builds a safe attachment Content-Disposition value for res.download().
 *
 * ASCII-safe filenames keep the historical header shape, while non-ASCII or
 * unsafe filenames get a sanitized fallback plus RFC 5987 filename* metadata.
 */
export function buildAttachmentContentDisposition(filename: string): string {
  const sanitized = sanitizeDownloadFilename(filename);
  const fallback = toAsciiFallback(sanitized);
  const encoded = encodeRfc5987Value(sanitized);

  if (fallback === sanitized && encoded === sanitized) {
    return `attachment; filename="${fallback}"`;
  }

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
