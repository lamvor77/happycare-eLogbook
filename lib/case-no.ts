export function makeCaseNo() {
  const now = new Date();

  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  const random = Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase();

  return `C${yy}${mm}${dd}-${random}`;
}