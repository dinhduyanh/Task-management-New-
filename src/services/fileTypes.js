// File types accepted for work item attachments. Mirrors backend/src/routes/attachments.js.
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const FILE_CATEGORIES = {
  image: { label: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
  pdf: { label: 'PDF', extensions: ['pdf'] },
  document: { label: 'Documents', extensions: ['doc', 'docx', 'txt'] },
  spreadsheet: { label: 'Spreadsheets', extensions: ['xls', 'xlsx', 'csv'] },
  presentation: { label: 'Presentations', extensions: ['ppt', 'pptx'] },
  archive: { label: 'Archives', extensions: ['zip'] }
};

export const ALLOWED_EXTENSIONS = Object.values(FILE_CATEGORIES).flatMap((category) => category.extensions);

/** Value for <input type="file" accept>. */
export const FILE_ACCEPT = ALLOWED_EXTENSIONS.map((extension) => `.${extension}`).join(',');

export const PREVIEWABLE_EXTENSIONS = new Set([...FILE_CATEGORIES.image.extensions, 'pdf']);

export function fileExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

export function fileCategory(nameOrExtension) {
  const extension = String(nameOrExtension || '').includes('.') ? fileExtension(nameOrExtension) : String(nameOrExtension || '').toLowerCase();
  return Object.keys(FILE_CATEGORIES).find((key) => FILE_CATEGORIES[key].extensions.includes(extension)) || 'other';
}

/** Returns an error message, or '' when the file can be uploaded. */
export function validateUploadFile(file) {
  const extension = fileExtension(file?.name);
  if (!ALLOWED_EXTENSIONS.includes(extension)) return `${file?.name || 'This file'}: .${extension || '?'} files are not supported.`;
  if (!file.size) return `${file.name} is empty.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than 10 MB.`;
  return '';
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
