'use client';

import { useState, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, AreaChart
} from 'recharts';

interface PriceChartProps {
  data30Day: Array<{ date: string; price: number }>;
  data90Day: Array<{ date: string; price: number }>;
  data1Year: Array<{ date: string; price: number }>;
}

type Range = '30d' | '90d' | '1y';

export function PriceChart({ data30Day, data90Day, data1Year }: PriceChartProps) {
  const [range, setRange] = useState<Range>('30d');

  const chartData = useMemo(() => {
    const data = range === '30d' ? data30Day : range === '90d' ? data90Day : data1Year;
    return data.map((d) => ({
      date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      price: d.price,
    }));
  }, [range, data30Day, data90Day, data1Year]);

  const hasData = chartData.length > 0;

  if (!hasData) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        No price data available for this range.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {([
          { key: '30d' as const, label: '30 Days' },
          { key: '90d' as const, label: '90 Days' },
          { key: '1y' as const, label: '1 Year' },
        ]).map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              range === r.key
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12 }}
              interval="preserveStartEnd"
              stroke="#94a3b8"
            />
            <YAxis
              tick={{ fontSize: 12 }}
              stroke="#94a3b8"
              tickFormatter={(v) => `$${v}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(255,255,255,0.95)',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '13px',
              }}
              formatter={(value: number) => [`$${value.toFixed(2)}`, 'Price']}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#priceGradient)"
              dot={false}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
