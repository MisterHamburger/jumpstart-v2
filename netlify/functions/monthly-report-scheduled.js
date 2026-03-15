// Scheduled wrapper — calls monthly-report on the 1st of each month
export const config = {
  schedule: "0 13 1 * *" // 1pm UTC = 9am ET
}

export default async () => {
  const res = await fetch('https://jumpstartscanner.netlify.app/.netlify/functions/monthly-report')
  const data = await res.json()
  console.log('Monthly report result:', data)
}
