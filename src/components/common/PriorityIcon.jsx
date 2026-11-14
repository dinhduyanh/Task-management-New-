import './PriorityIcon.css';

/**
 * Priority icons inspired by the Nexus reference UI.
 * Supported values: High, Highest, Low, Lowest, Medium.
 */
export default function PriorityIcon({ priority, size = 16 }) {
  const normalizedPriority = String(priority || 'Medium').toLowerCase();

  let iconShape;

  switch (normalizedPriority) {
    case 'high':
      iconShape = <path d="M5.5 14.5 12 8l6.5 6.5" />;
      break;

    case 'highest':
      iconShape = (
        <>
          <path d="M5.5 10.5 12 4l6.5 6.5" />
          <path d="M5.5 17.5 12 11l6.5 6.5" />
        </>
      );
      break;

    case 'low':
      iconShape = <path d="M5.5 9.5 12 16l6.5-6.5" />;
      break;

    case 'lowest':
      iconShape = (
        <>
          <path d="M5.5 6.5 12 13l6.5-6.5" />
          <path d="M5.5 13.5 12 20l6.5-6.5" />
        </>
      );
      break;

    case 'medium':
    default:
      iconShape = (
        <>
          <path d="M5 9h14" />
          <path d="M5 15h14" />
        </>
      );
      break;
  }

  return (
    <svg
      className={`priority-icon priority-icon--${normalizedPriority}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={normalizedPriority === 'medium' ? 2.5 : 2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={`${priority || 'Medium'} priority`}
      role="img"
    >
      {iconShape}
    </svg>
  );
}
