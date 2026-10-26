export function csvCell(value: string) {
  const text = /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
  return '"' + text.replace(/"/g, '""') + '"';
}
