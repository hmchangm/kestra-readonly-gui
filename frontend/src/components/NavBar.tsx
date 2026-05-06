import { NavLink } from 'react-router-dom'

export function NavBar() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-3 text-sm border-b-2 ${
      isActive
        ? 'border-blue-400 text-white'
        : 'border-transparent text-gray-300 hover:text-white hover:border-gray-500'
    }`

  return (
    <nav className="bg-gray-900 text-white">
      <div className="max-w-6xl mx-auto px-6 flex items-center gap-6">
        <div className="font-semibold">Kestra GUI</div>
        <div className="flex items-center gap-1">
          <NavLink to="/" end className={linkClass}>Executions</NavLink>
          <NavLink to="/flows" className={linkClass}>Flows</NavLink>
        </div>
      </div>
    </nav>
  )
}
