// Ordering of dashboards for the sidebar: starred first, then the most recently opened,
// then the most recently updated. Shared by the sidebar and the All dashboards page.
export const SIDEBAR_DASHBOARD_LIMIT = 5;

function time(value) {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function sidebarDashboards(dashboards, limit = SIDEBAR_DASHBOARD_LIMIT) {
  return [...(Array.isArray(dashboards) ? dashboards : [])]
    .filter((dashboard) => dashboard.status !== 'inactive' || dashboard.starred)
    .sort((left, right) => (Number(right.starred) - Number(left.starred))
      || (time(right.lastVisitedAt) - time(left.lastVisitedAt))
      || (time(right.updatedAt) - time(left.updatedAt)))
    .slice(0, limit);
}
