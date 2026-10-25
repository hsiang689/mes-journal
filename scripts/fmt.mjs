// 和 store.js 相同的 JSON 格式：數字陣列放同一行，git diff 比較好讀
export function fmt(v, ind = '') {
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    if (v.every((x) => x === null || typeof x !== 'object')) return '[' + v.map((x) => JSON.stringify(x)).join(',') + ']';
    if (v.every((x) => Array.isArray(x) && x.every((y) => y === null || typeof y !== 'object'))) return '[\n' + v.map((x) => ind + '  ' + fmt(x)).join(',\n') + '\n' + ind + ']';
    return '[\n' + v.map((x) => ind + '  ' + fmt(x, ind + '  ')).join(',\n') + '\n' + ind + ']';
  }
  if (v && typeof v === 'object') {
    const ks = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    if (!ks.length) return '{}';
    return '{\n' + ks.map((k) => ind + '  ' + JSON.stringify(k) + ': ' + fmt(v[k], ind + '  ')).join(',\n') + '\n' + ind + '}';
  }
  return JSON.stringify(v);
}
export const toText = (v) => fmt(v) + '\n';
