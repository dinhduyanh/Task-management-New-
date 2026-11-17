import { Router } from 'express';
import { db } from '../db.js';
import { canAccessSpace } from '../access.js';
import { listWorkflows } from '../workflows.js';

const router = Router();

// Every workflow with its states and transitions.
router.get('/workflows', (_req, res) => {
  res.json(listWorkflows());
});

// The same list for a project, with how many of its work items use each workflow and each state.
router.get('/spaces/:spaceId/workflows', (req, res) => {
  const { spaceId } = req.params;
  if (!canAccessSpace(req.user, spaceId)) return res.status(404).json({ error: 'Space not found.' });
  const rows = db.prepare('SELECT issue_type, status, COUNT(*) AS count FROM work_items WHERE space_id = ? GROUP BY issue_type, status').all(spaceId);
  res.json(listWorkflows().map((workflow) => {
    const types = workflow.issueTypes.map((type) => type.toLowerCase());
    const mine = rows.filter((row) => types.includes(String(row.issue_type || '').toLowerCase()));
    const byState = {};
    mine.forEach((row) => { byState[row.status] = (byState[row.status] || 0) + row.count; });
    return {
      ...workflow,
      workItemCount: mine.reduce((sum, row) => sum + row.count, 0),
      states: workflow.states.map((state) => ({ ...state, workItemCount: byState[state.name] || 0 }))
    };
  }));
});

export default router;
