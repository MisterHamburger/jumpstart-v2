import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * Fetch ALL rows from a query, paginating past the PostgREST row limit.
 * Pass a function that builds a fresh query each call (Supabase builders are mutable).
 * Usage: const rows = await fetchAll(() => supabase.from('table').select('*').eq('col', val))
 */
export async function fetchAll(buildQuery) {
  const PAGE = 1000
  let all = []
  let from = 0
  while (true) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}
