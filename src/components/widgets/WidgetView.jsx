import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import './WidgetView.css';

// Categorical series colours, readable on light and dark surfaces.
const SERIES_COLORS = ['#2684ff', '#36b37e', '#ffab00', '#ff5630', '#6554c0', '#00b8d9', '#ff7452', '#57d9a3'];
const AXIS = { stroke: 'var(--tf-text-muted)', fontSize: 11 };
const TOOLTIP_STYLE = { background: 'var(--tf-surface)', border: '1px solid var(--tf-border)', borderRadius: 6, color: 'var(--tf-text)', fontSize: 12 };


function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Chart data from a query result: the first column is the label, every other column
 * that holds numbers is a series.
 */
function chartData({ columns, rows }) {
  const seriesIndexes = columns.map((_, index) => index).slice(1)
    .filter((index) => rows.some((row) => toNumber(row[index]) !== null));
  const data = rows.map((row) => {
    const point = { label: row[0] === null || row[0] === undefined ? '(empty)' : String(row[0]) };
    seriesIndexes.forEach((index) => { point[columns[index]] = toNumber(row[index]) ?? 0; });
    return point;
  });
  return { data, series: seriesIndexes.map((index) => columns[index]) };
}

function ResultTable({ columns, rows }) {
  return (
    <div className="wv-table-wrap">
      <table className="wv-table">
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((value, index) => <td key={index}>{value === null ? <span className="wv-null">NULL</span> : String(value)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Renders a widget query result ({ columns, rows }) as the chosen chart type. */
export default function WidgetView({ chartType = 'table', result, height = 240 }) {
  if (!result) return null;
  const { columns = [], rows = [] } = result;
  if (!rows.length) return <div className="wv-empty">The query returned no rows.</div>;

  if (chartType === 'table') return <ResultTable columns={columns} rows={rows} />;

  if (chartType === 'number') {
    const index = columns.findIndex((_, i) => toNumber(rows[0][i]) !== null);
    const value = index >= 0 ? toNumber(rows[0][index]) : rows[0][0];
    return (
      <div className="wv-number">
        <strong>{typeof value === 'number' ? value.toLocaleString() : String(value)}</strong>
        <span>{columns[index >= 0 ? index : 0]}</span>
      </div>
    );
  }

  const { data, series } = chartData(result);
  if (!series.length) {
    return <div className="wv-empty">A chart needs a label column followed by at least one numeric column. Showing a table instead.<ResultTable columns={columns} rows={rows} /></div>;
  }

  if (chartType === 'pie') {
    const key = series[0];
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} dataKey={key} nameKey="label" innerRadius="45%" outerRadius="80%" paddingAngle={2} stroke="var(--tf-surface)">
            {data.map((point, index) => <Cell key={point.label} fill={SERIES_COLORS[index % SERIES_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 12, color: 'var(--tf-text-muted)' }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  const Chart = chartType === 'line' ? LineChart : BarChart;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
        <CartesianGrid stroke="var(--tf-border)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} stroke="var(--tf-border)" />
        <YAxis tick={AXIS} stroke="var(--tf-border)" allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--tf-surface-muted)' }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: 'var(--tf-text-muted)' }} />}
        {series.map((key, index) => (chartType === 'line'
          ? <Line key={key} type="monotone" dataKey={key} stroke={SERIES_COLORS[index % SERIES_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
          : <Bar key={key} dataKey={key} fill={SERIES_COLORS[index % SERIES_COLORS.length]} radius={[4, 4, 0, 0]} maxBarSize={48} />))}
      </Chart>
    </ResponsiveContainer>
  );
}
