import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { CHART_COLORS } from '../../constants/index.js';

const AXIS = { fontSize: 11, fill: '#64748b' };
const GRID = '#e2e8f0';

const tooltipStyle = {
  contentStyle: {
    borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12,
    boxShadow: '0 10px 32px -8px rgb(15 23 42 / 0.18)',
  },
};

export function BarChartCard({ data, xKey, bars, height = 260, stacked }) {
  if (!data?.length) return <p className="text-sm text-slate-500 py-8 text-center">No data to chart yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip {...tooltipStyle} cursor={{ fill: '#f1f5f9' }} />
        {bars.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {bars.map((bar, index) => (
          <Bar key={bar.key} dataKey={bar.key} name={bar.label} radius={[4, 4, 0, 0]}
               stackId={stacked ? 'a' : undefined}
               fill={bar.color ?? CHART_COLORS[index % CHART_COLORS.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LineChartCard({ data, xKey, lines, height = 260 }) {
  if (!data?.length) return <p className="text-sm text-slate-500 py-8 text-center">No data to chart yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip {...tooltipStyle} />
        {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {lines.map((line, index) => (
          <Line key={line.key} type="monotone" dataKey={line.key} name={line.label}
                stroke={line.color ?? CHART_COLORS[index % CHART_COLORS.length]}
                strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DonutChartCard({ data, nameKey, valueKey, height = 260 }) {
  if (!data?.length) return <p className="text-sm text-slate-500 py-8 text-center">No data to chart yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius="52%" outerRadius="80%"
             paddingAngle={2} stroke="#fff" strokeWidth={2}>
          {data.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
        </Pie>
        <Tooltip {...tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
