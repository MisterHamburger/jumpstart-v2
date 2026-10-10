// Today's date (YYYY-MM-DD) in the browser's local time zone. Use this, not
// new Date().toISOString().slice(0, 10), for business dates: toISOString is
// UTC, so anything stamped in the evening lands on tomorrow's date.
export function localToday() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
