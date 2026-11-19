/** Lower-case text without diacritics, so "pham" matches "Phạm" and "dinh" matches "Đinh". */
export function searchText(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}
