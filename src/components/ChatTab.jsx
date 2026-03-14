import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

const CHAT_USER_KEY = 'chat_user_name'

export default function ChatTab() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [userName, setUserName] = useState(() => localStorage.getItem(CHAT_USER_KEY) || '')
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Load existing messages on mount
  useEffect(() => {
    loadMessages()
  }, [])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input after user picks name
  useEffect(() => {
    if (userName && inputRef.current) inputRef.current.focus()
  }, [userName])

  async function loadMessages() {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(100)

    if (!error && data) setMessages(data)
    setInitialLoading(false)
  }

  function selectUser(name) {
    localStorage.setItem(CHAT_USER_KEY, name)
    setUserName(name)
  }

  async function sendMessage(e) {
    e.preventDefault()
    const q = input.trim()
    if (!q || loading) return

    setInput('')
    setLoading(true)

    // Optimistic: show user question immediately
    const tempMsg = { id: 'temp', user_name: userName, question: q, answer: null, created_at: new Date().toISOString() }
    setMessages(prev => [...prev, tempMsg])

    try {
      const res = await fetch('/.netlify/functions/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          user_name: userName,
          history: messages.slice(-10).map(m => ({ question: m.question, answer: m.answer })),
        })
      })

      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Chat failed')

      // Replace temp message with real response
      setMessages(prev => prev.map(m =>
        m.id === 'temp'
          ? { ...m, id: data.id || Date.now(), answer: data.answer, chart_type: data.chart_type, chart_data: data.chart_data, chart_config: data.chart_config }
          : m
      ))
    } catch (err) {
      console.error('Chat error:', err)
      setMessages(prev => prev.map(m =>
        m.id === 'temp'
          ? { ...m, id: Date.now(), answer: `Error: ${err.message}. Try again.` }
          : m
      ))
    } finally {
      setLoading(false)
    }
  }

  // User picker
  if (!userName) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-lg text-white font-semibold mb-6">Who are you?</div>
        <div className="flex gap-4">
          {['Jer', 'Josh'].map(name => (
            <button key={name} onClick={() => selectUser(name)}
              className="px-8 py-4 rounded-2xl text-lg font-bold bg-cyan-600 text-white hover:bg-cyan-500 transition-all shadow-lg shadow-cyan-600/30">
              {name}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (initialLoading) {
    return <div className="text-slate-400 py-12 text-center">Loading chat...</div>
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 220px)', minHeight: '400px' }}>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4 pr-1">
        {messages.length === 0 && (
          <div className="text-center py-16">
            <div className="text-slate-500 text-lg mb-2">No messages yet</div>
            <div className="text-slate-600 text-sm">Ask a question about Jumpstart business data</div>
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {loading && messages[messages.length - 1]?.answer === null && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-cyan-600/20 flex items-center justify-center flex-shrink-0">
              <iconify-icon icon="lucide:bot" width="16" class="text-cyan-400"></iconify-icon>
            </div>
            <div className="glass-card rounded-2xl rounded-tl-sm px-4 py-3 max-w-[80%]">
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <span className="animate-pulse">Thinking</span>
                <span className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                  <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                  <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                </span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="flex gap-3 pt-4 border-t border-white/[0.06]">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask about your business data..."
          disabled={loading}
          className="flex-1 bg-white/[0.06] border border-white/[0.08] rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-5 py-3 rounded-xl bg-cyan-600 text-white font-semibold hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-cyan-600/20">
          <iconify-icon icon="lucide:send" width="18"></iconify-icon>
        </button>
      </form>

      {/* User indicator */}
      <div className="flex items-center justify-between mt-2">
        <div className="text-xs text-slate-600">
          Chatting as <span className="text-cyan-400">{userName}</span>
        </div>
        <button onClick={() => { localStorage.removeItem(CHAT_USER_KEY); setUserName('') }}
          className="text-xs text-slate-600 hover:text-slate-400 transition-colors">
          Switch user
        </button>
      </div>
    </div>
  )
}

function MessageBubble({ msg }) {
  const time = new Date(msg.created_at).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  })

  return (
    <div className="space-y-3">
      {/* User question - right aligned */}
      <div className="flex justify-end items-start gap-3">
        <div className="max-w-[80%]">
          <div className="text-xs text-slate-600 text-right mb-1">{msg.user_name} &middot; {time}</div>
          <div className="bg-cyan-600/20 border border-cyan-500/20 rounded-2xl rounded-tr-sm px-4 py-3 text-white text-sm">
            {msg.question}
          </div>
        </div>
        <div className="w-8 h-8 rounded-full bg-cyan-600/30 flex items-center justify-center flex-shrink-0 text-xs font-bold text-cyan-300">
          {msg.user_name?.[0]}
        </div>
      </div>

      {/* AI answer - left aligned */}
      {msg.answer && (
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-cyan-600/20 flex items-center justify-center flex-shrink-0">
            <iconify-icon icon="lucide:bot" width="16" class="text-cyan-400"></iconify-icon>
          </div>
          <div className="max-w-[85%] space-y-3">
            <div className="glass-card rounded-2xl rounded-tl-sm px-4 py-3 text-slate-200 text-sm whitespace-pre-wrap leading-relaxed">
              {msg.answer}
            </div>

            {/* Chart */}
            {msg.chart_data && msg.chart_type && msg.chart_config && (
              <div className="glass-card rounded-2xl p-4">
                <ChatChart
                  type={msg.chart_type}
                  data={msg.chart_data}
                  config={msg.chart_config}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ChatChart({ type, data, config }) {
  if (!data || !config || !config.xKey || !config.yKey) return null

  const chartColor = '#06b6d4' // cyan-500
  const gridColor = 'rgba(255,255,255,0.06)'

  const formatValue = (val) => {
    const n = Number(val)
    if (isNaN(n)) return val
    if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`
    if (config.yLabel?.includes('%') || config.yKey?.includes('margin') || config.yKey?.includes('percent'))
      return `${n.toFixed(1)}%`
    return `$${n.toFixed(0)}`
  }

  const tooltipFormatter = (val) => {
    const n = Number(val)
    if (isNaN(n)) return val
    if (config.yLabel?.includes('%') || config.yKey?.includes('margin') || config.yKey?.includes('percent'))
      return `${n.toFixed(1)}%`
    return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const ChartComponent = type === 'line' ? LineChart : BarChart

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ChartComponent data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
        <XAxis
          dataKey={config.xKey}
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: gridColor }}
        />
        <YAxis
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          tickFormatter={formatValue}
          tickLine={false}
          axisLine={{ stroke: gridColor }}
          label={config.yLabel ? { value: config.yLabel, angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 } : undefined}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '12px' }}
          labelStyle={{ color: '#94a3b8' }}
          formatter={tooltipFormatter}
        />
        {type === 'line' ? (
          <Line type="monotone" dataKey={config.yKey} stroke={chartColor} strokeWidth={2} dot={{ fill: chartColor, r: 4 }} activeDot={{ r: 6 }} />
        ) : (
          <Bar dataKey={config.yKey} fill={chartColor} radius={[4, 4, 0, 0]} />
        )}
      </ChartComponent>
    </ResponsiveContainer>
  )
}
