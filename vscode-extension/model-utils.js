function buildChildrenLookup(modules) {
  const output = new Map();
  for (const module of modules || []) {
    const parentId = module.parent_id || '__root__';
    if (!output.has(parentId)) {
      output.set(parentId, []);
    }
    output.get(parentId).push(module);
  }

  for (const [key, items] of output.entries()) {
    items.sort((a, b) => {
      if (a.level !== b.level) {
        return a.level - b.level;
      }
      return String(a.name).localeCompare(String(b.name));
    });
    output.set(key, items);
  }

  return output;
}

function findSystemModule(modules) {
  const list = modules || [];
  const explicit = list.find((item) => item.level === 0 && !item.parent_id);
  if (explicit) {
    return explicit;
  }
  if (!list.length) {
    return null;
  }
  const sorted = [...list].sort((a, b) => a.level - b.level || String(a.name).localeCompare(String(b.name)));
  return sorted[0];
}

module.exports = {
  buildChildrenLookup,
  findSystemModule,
};
