// `cytoscape-elk` ships no type declarations (its package.json has no `types`
// field, and there is no `@types/cytoscape-elk` on the npm registry). This is
// the standard ambient-module shape cytoscape's own `Ext` doc comment
// recommends for untyped extensions: the module's default export is the
// registration function `cytoscape.use()` expects.
declare module 'cytoscape-elk' {
  import cytoscape from 'cytoscape'

  const elkExtension: cytoscape.Ext
  export default elkExtension
}
