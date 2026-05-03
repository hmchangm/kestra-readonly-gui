import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { HourlyBucket } from '../types/execution'

const STATE_COLORS: Record<string, string> = {
  success: '#4ade80',
  failed:  '#f87171',
  running: '#60a5fa',
  killed:  '#94a3b8',
  warning: '#f59e0b',
}

interface TimelineChartProps {
  data: HourlyBucket[]
}

export function TimelineChart({ data }: TimelineChartProps) {
  const formatted = data.map(b => ({
    ...b,
    hour: new Date(b.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }))

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={formatted} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        {Object.entries(STATE_COLORS).map(([state, color]) => (
          <Bar key={state} dataKey={state} stackId="stack" fill={color} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
