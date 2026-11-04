/** Object key order is not business data; ordered arrays remain significant. */
export function sameData(a: unknown, b: unknown): boolean {
  const sorted=(value:unknown):unknown=>Array.isArray(value)?value.map(sorted):value!==null&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sorted(v)])):value;
  return JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
}
