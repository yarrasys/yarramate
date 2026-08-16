import cytoscape from 'cytoscape';
import elk from 'cytoscape-elk';
cytoscape.use(elk);

const build = () => cytoscape({
  styleEnabled: true,
  style: [{ selector: 'node', style: { width: 170, height: 50 } }],
  layout: { name: 'null' },
  elements: [
    { data: { id: 'a' }, group: 'nodes' },
    { data: { id: 'b' }, group: 'nodes' },
    { data: { id: 'c' }, group: 'nodes' },
    { data: { id: 'd' }, group: 'nodes' },
    { data: { id: 'e' }, group: 'nodes' },
    { data: { id: 'f' }, group: 'nodes' },
    { data: { id: 'ab', source: 'a', target: 'b' }, group: 'edges' },
    { data: { id: 'bc', source: 'b', target: 'c' }, group: 'edges' },
    { data: { id: 'cd', source: 'c', target: 'd' }, group: 'edges' },
    { data: { id: 'de', source: 'd', target: 'e' }, group: 'edges' },
    { data: { id: 'ef', source: 'e', target: 'f' }, group: 'edges' },
    { data: { id: 'fa', source: 'f', target: 'a' }, group: 'edges' },
  ],
});

const run = (cy, opts) => new Promise((resolve) => {
  cy.one('layoutstop', resolve);
  cy.layout(opts).run();
});

const posMap = (cy) => Object.fromEntries(cy.nodes().map(n => [n.id(), n.position()]));

async function main() {
  // no seed at all, twice
  const cy1 = build();
  const cy2 = build();
  await run(cy1, { name: 'elk', elk: { algorithm: 'layered', 'elk.direction': 'DOWN' } });
  await run(cy2, { name: 'elk', elk: { algorithm: 'layered', 'elk.direction': 'DOWN' } });
  console.log('no-seed identical?', JSON.stringify(posMap(cy1)) === JSON.stringify(posMap(cy2)));

  // seed 'fixed-seed' string twice
  const cy3 = build();
  const cy4 = build();
  await run(cy3, { name: 'elk', elk: { algorithm: 'layered', 'elk.direction': 'DOWN', 'elk.randomSeed': 'fixed-seed' } });
  await run(cy4, { name: 'elk', elk: { algorithm: 'layered', 'elk.direction': 'DOWN', 'elk.randomSeed': 'fixed-seed' } });
  console.log('seed=fixed-seed identical?', JSON.stringify(posMap(cy3)) === JSON.stringify(posMap(cy4)));

  // seed 'other-seed' vs 'fixed-seed' - does it differ?
  const cy5 = build();
  await run(cy5, { name: 'elk', elk: { algorithm: 'layered', 'elk.direction': 'DOWN', 'elk.randomSeed': 'other-seed-xyz' } });
  console.log('fixed-seed vs other-seed differ?', JSON.stringify(posMap(cy3)) !== JSON.stringify(posMap(cy5)));

  // numeric seed vs numeric seed
  const cy6 = build();
  const cy7 = build();
  await run(cy6, { name: 'elk', elk: { algorithm: 'layered', 'elk.direction': 'DOWN', 'elk.randomSeed': '42' } });
  await run(cy7, { name: 'elk', elk: { algorithm: 'layered', 'elk.direction': 'DOWN', 'elk.randomSeed': '99' } });
  console.log('seed 42 vs 99 differ?', JSON.stringify(posMap(cy6)) !== JSON.stringify(posMap(cy7)));
  console.log('positions cy1', posMap(cy1));
}
main();
