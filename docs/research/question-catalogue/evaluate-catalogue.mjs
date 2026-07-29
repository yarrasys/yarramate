// Draft reference evaluator for yarramate/question-catalogue/v1.
// Validates the catalogue against the draft schema, then evaluates every
// trigger deterministically against a compiled graph-v2 workspace.
// Simplification vs the intended gap engine: kindMatching is evaluated as
// "exact" because graph v2 carries profile identities, not kind lineage.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/Users/nabsha/work/yarrasys/projects/yarramate/package.json');
const Ajv2020 = require('ajv/dist/2020').default;
const YAML = require('yaml');

const [schemaPath, cataloguePath, graphPath] = process.argv.slice(2);
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const catalogue = YAML.parse(readFileSync(cataloguePath, 'utf8'));
const graph = JSON.parse(readFileSync(graphPath, 'utf8'));

// --- validate ---------------------------------------------------------------
const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(schema);
if (!validate(catalogue)) {
  console.error('CATALOGUE INVALID:');
  for (const e of validate.errors) console.error(` ${e.instancePath} ${e.message}`);
  process.exit(1);
}
const waveIds = new Set(catalogue.waves.map((w) => w.id));
for (const q of catalogue.questions) {
  if (!waveIds.has(q.wave)) {
    console.error(`CATALOGUE INVALID: question ${q.id} references unknown wave ${q.wave}`);
    process.exit(1);
  }
}
console.log(`catalogue valid: ${catalogue.id}@${catalogue.version}, ${catalogue.questions.length} questions, ${catalogue.waves.length} waves`);

// --- index the graph --------------------------------------------------------
const concepts = new Set(graph.subjects.filter((s) => s.type === 'concept').map((s) => s.id));
const byPredicate = new Map();
const claimsBySubject = new Map();
for (const c of graph.claims) {
  if (!byPredicate.has(c.predicate)) byPredicate.set(c.predicate, []);
  byPredicate.get(c.predicate).push(c);
  if (!claimsBySubject.has(c.subject)) claimsBySubject.set(c.subject, []);
  claimsBySubject.get(c.subject).push(c);
}
const isRelPredicate = (p) => p.includes('#');
const relClaims = graph.claims.filter((c) => isRelPredicate(c.predicate));

const kindOf = new Map();
for (const c of byPredicate.get('yarramate/concept/kind') ?? []) kindOf.set(c.subject, c.object.value);
const nameOf = new Map();
for (const c of byPredicate.get('yarramate/concept/name') ?? []) nameOf.set(c.subject, c.object.value);
const statusOf = new Map();
for (const c of byPredicate.get('yarramate/lifecycle/status') ?? []) statusOf.set(c.subject, c.object.value);
const stateSubjects = new Set((byPredicate.get('yarramate/state/type') ?? []).map((c) => c.subject));

// state subjects are not enrichment targets for concept questions
for (const s of stateSubjects) concepts.delete(s);

// --- selector ---------------------------------------------------------------
function selectSubjects(selector) {
  const kinds = new Set(selector.kinds);
  let ids = [...concepts].filter((id) => kinds.has(kindOf.get(id)));
  if (selector.statuses) {
    const st = new Set(selector.statuses);
    ids = ids.filter((id) => st.has(statusOf.get(id)));
  }
  if (selector.documents) {
    const docs = new Set(selector.documents);
    ids = ids.filter((id) => docs.has(id.split('#')[0]));
  }
  return ids;
}

// --- conditions -------------------------------------------------------------
function holds(cond, subjectId) {
  switch (cond.condition) {
    case 'missing-claim':
      return !(claimsBySubject.get(subjectId) ?? []).some((c) => c.predicate === cond.predicate);
    case 'missing-relationship': {
      const kinds = new Set(cond.kinds);
      const touches = relClaims.filter((c) => kinds.has(c.predicate));
      const out = touches.some((c) => c.subject === subjectId);
      const inc = touches.some((c) => c.object?.ref === subjectId);
      if (cond.direction === 'outgoing') return !out;
      if (cond.direction === 'incoming') return !inc;
      return !out && !inc;
    }
    case 'isolated':
      // A subject is isolated only if it participates in no relationship AND
      // is not the target of any reference-bearing claim (ownership,
      // identified reference, constraint), which also expresses participation.
      return (
        !relClaims.some((c) => c.subject === subjectId || c.object?.ref === subjectId) &&
        !graph.claims.some((c) => !isRelPredicate(c.predicate) && c.object?.ref === subjectId)
      );
    case 'no-subject-of-kind': {
      const kinds = new Set(cond.kinds);
      return ![...concepts].some((id) => kinds.has(kindOf.get(id)));
    }
    case 'no-state-defined':
      return stateSubjects.size === 0;
    default:
      throw new Error(`unknown condition ${cond.condition}`);
  }
}

// --- evaluate ---------------------------------------------------------------
const label = (id) => nameOf.get(id) ?? id;
let totalOpen = 0;
for (const wave of catalogue.waves) {
  const qs = catalogue.questions.filter((q) => q.wave === wave.id);
  console.log(`\n== ${wave.name} ==`);
  for (const q of qs) {
    if (q.scope === 'workspace') {
      const open = q.trigger.every((c) => holds(c, null));
      console.log(`  ${open ? 'OPEN  ' : 'closed'} ${q.id}${open ? ` — ${q.question.trim()}` : ''}`);
      if (open) totalOpen += 1;
    } else {
      const matches = selectSubjects(q.subjects).filter((id) => q.trigger.every((c) => holds(c, id)));
      totalOpen += matches.length;
      const examples = matches.slice(0, 3).map(label).join('; ');
      console.log(`  ${matches.length ? 'OPEN  ' : 'closed'} ${q.id} (${matches.length} subjects)${matches.length ? ` — e.g. ${examples}` : ''}`);
      if (matches.length) {
        const rendered = q.question.trim().replaceAll('{subject.name}', label(matches[0])).replaceAll('{subject.id}', matches[0]);
        console.log(`         ask: "${rendered}" [authority: ${q.authority}]`);
      }
    }
  }
}
console.log(`\ntotal open questions on this workspace: ${totalOpen}`);
