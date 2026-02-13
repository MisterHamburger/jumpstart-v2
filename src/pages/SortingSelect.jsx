import { useNavigate } from 'react-router-dom'

export default function SortingSelect() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-10">
      <button
        onClick={() => navigate('/')}
        className="self-start mb-8 text-slate-400 hover:text-white transition-colors"
      >
        ← Home
      </button>

      <h2 className="text-3xl font-bold mb-2">Sorting</h2>
      <p className="text-slate-400 mb-10">Choose sorting mode</p>

      <div className="w-full max-w-md space-y-5">
        <button
          onClick={() => navigate('/sorting/general')}
          className="w-full rounded-2xl p-6 text-left
            bg-gradient-to-r from-purple-600 to-violet-600
            hover:from-purple-500 hover:to-violet-500
            active:scale-[0.98] transition-all"
        >
          <div className="text-xl font-bold">General Sort</div>
          <div className="text-sm text-white/70">Scan → Zone assignment</div>
        </button>

        <button
          onClick={() => navigate('/sorting/bundle')}
          className="w-full rounded-2xl p-6 text-left
            bg-gradient-to-r from-pink-600 to-rose-600
            hover:from-pink-500 hover:to-rose-500
            active:scale-[0.98] transition-all"
        >
          <div className="text-xl font-bold">Bundle Sort</div>
          <div className="text-sm text-white/70">Scan → Box number</div>
        </button>
      </div>
    </div>
  )
}
