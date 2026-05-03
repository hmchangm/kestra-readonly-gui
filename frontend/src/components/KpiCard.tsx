type CardColor = 'default' | 'green' | 'red' | 'blue'

const COLOR_CLASSES: Record<CardColor, string> = {
  default: 'border-indigo-200 text-indigo-700',
  green:   'border-green-200  text-green-700',
  red:     'border-red-200    text-red-700',
  blue:    'border-blue-200   text-blue-700',
}

interface KpiCardProps {
  label: string
  value: string | number
  color?: CardColor
}

export function KpiCard({ label, value, color = 'default' }: KpiCardProps) {
  return (
    <div className={`border rounded-lg p-4 text-center min-w-[120px] ${COLOR_CLASSES[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}
