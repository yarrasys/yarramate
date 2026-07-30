// Degenerate-run detection.
//
// A change or model-maintenance run that exits cleanly after one or two turns
// did not do the work — it acknowledged the prompt and stopped. The harness
// records exit code 0, so the harness-failure counter never sees it and the
// adjudicator meets it as an ordinary fail. Flagging is evidence, not a
// verdict: the run still gets scored and adjudicated normally.

export const DEGENERATE_MIN_TURNS = 3;

const REVIEWED_FAMILIES = new Set(['change', 'model-maintenance']);

// true / false / null when the turn count is unknown (unparseable transcript).
export const isDegenerateRun = (family, metrics) => {
  if (!REVIEWED_FAMILIES.has(family)) return false;
  const turns = metrics?.numTurns ?? null;
  return turns === null ? null : turns < DEGENERATE_MIN_TURNS;
};
