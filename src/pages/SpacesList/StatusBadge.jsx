import { statusTone } from './issueHelpers';
import './StatusBadge.css';

/** A work item status, coloured by its family (to do, in progress, review, blocked, done, cancelled). */
export default function StatusBadge({ status, className = '' }) {
  return <span className={`tf-status-badge tone-${statusTone(status)} ${className}`} title={status}>{status}</span>;
}
