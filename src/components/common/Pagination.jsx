import './Pagination.css';

/** "1-10 of 18" summary, previous / current page / next, and a page size selector. */
export default function Pagination({ page, pageSize, total, pageSizes = [10, 20, 50], label = 'items', onPageChange, onPageSizeChange }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  const first = total ? (current - 1) * pageSize + 1 : 0;
  const last = Math.min(current * pageSize, total);
  return (
    <footer className="pg-foot">
      <span>{first}-{last} of {total}</span>
      <div className="pg-pager">
        <button type="button" disabled={current <= 1} onClick={() => onPageChange(current - 1)} aria-label="Previous page">‹</button>
        <span className="pg-page" aria-current="page" aria-label={`Page ${current} of ${pageCount}`}>{current}</span>
        <button type="button" disabled={current >= pageCount} onClick={() => onPageChange(current + 1)} aria-label="Next page">›</button>
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} aria-label={`${label} per page`}>
          {pageSizes.map((size) => <option key={size} value={size}>{size} / Page</option>)}
        </select>
      </div>
    </footer>
  );
}
