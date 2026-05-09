'use client';

interface Indicator {
  indicator_id: string;
  radar: string;
  mean: number;
  confidence: number;
  evidence_count: number;
  label_low: string;
  label_high: string;
  policy_area: string;
}

interface RadarChartProps {
  indicators: Indicator[];
  ideologyIndicators: Indicator[];
}

/**
 * SVG-based radar/spider chart showing politician's indicator profile.
 * Renders policy indicators as a polygon on a radial grid, with
 * ideology indicators shown as labelled markers below.
 */
export default function RadarChart({ indicators, ideologyIndicators }: RadarChartProps) {
  // Take top 8 policy indicators by confidence for the radar
  const radarItems = indicators.slice(0, 8);

  if (radarItems.length < 3) {
    return (
      <div className="flex flex-col items-center gap-4">
        {radarItems.length > 0 && (
          <div className="grid w-full gap-2">
            {radarItems.map((ind) => (
              <BarIndicator key={ind.indicator_id} indicator={ind} />
            ))}
          </div>
        )}
        {ideologyIndicators.length > 0 && (
          <div className="mt-2 grid w-full gap-2">
            <p className="text-xs text-wh-text-tertiary uppercase tracking-wider">Ideology</p>
            {ideologyIndicators.map((ind) => (
              <BarIndicator key={ind.indicator_id} indicator={ind} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const cx = 150;
  const cy = 150;
  const radius = 120;
  const n = radarItems.length;
  const angleStep = (2 * Math.PI) / n;

  // Grid rings at 25%, 50%, 75%, 100%
  const rings = [0.25, 0.5, 0.75, 1.0];

  // Compute polygon points (mean values)
  const points = radarItems.map((ind, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const r = ind.mean * radius;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  const polygonPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';

  // Confidence polygon (outer bounds)
  const confPoints = radarItems.map((ind, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const r = ind.confidence * radius;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  const confPath = confPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';

  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 300 300" className="w-full max-w-[320px]">
        {/* Grid rings */}
        {rings.map((r) => (
          <circle
            key={r}
            cx={cx}
            cy={cy}
            r={r * radius}
            fill="none"
            stroke="var(--wh-border)"
            strokeWidth={0.5}
            opacity={0.6}
          />
        ))}

        {/* Axis lines */}
        {radarItems.map((_, i) => {
          const angle = -Math.PI / 2 + i * angleStep;
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={cx + radius * Math.cos(angle)}
              y2={cy + radius * Math.sin(angle)}
              stroke="var(--wh-border)"
              strokeWidth={0.5}
              opacity={0.4}
            />
          );
        })}

        {/* Confidence fill */}
        <path d={confPath} fill="var(--wh-accent-teal)" opacity={0.08} />

        {/* Value polygon */}
        <path
          d={polygonPath}
          fill="var(--wh-accent-teal)"
          fillOpacity={0.2}
          stroke="var(--wh-accent-teal)"
          strokeWidth={1.5}
        />

        {/* Data points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={3}
            fill="var(--wh-accent-teal)"
          />
        ))}

        {/* Labels */}
        {radarItems.map((ind, i) => {
          const angle = -Math.PI / 2 + i * angleStep;
          const labelR = radius + 16;
          const x = cx + labelR * Math.cos(angle);
          const y = cy + labelR * Math.sin(angle);
          const shortLabel = ind.policy_area || ind.indicator_id.split('.')[1]?.replace(/_/g, ' ') || ind.indicator_id;
          return (
            <text
              key={ind.indicator_id}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-wh-text-secondary text-[9px]"
            >
              {shortLabel.slice(0, 16)}
            </text>
          );
        })}
      </svg>

      {/* Ideology indicators as bars below */}
      {ideologyIndicators.length > 0 && (
        <div className="w-full">
          <p className="mb-2 text-xs text-wh-text-tertiary uppercase tracking-wider">Ideology</p>
          <div className="grid gap-2">
            {ideologyIndicators.map((ind) => (
              <BarIndicator key={ind.indicator_id} indicator={ind} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BarIndicator({ indicator }: { indicator: Indicator }) {
  const pct = Math.round(indicator.mean * 100);
  const label = indicator.indicator_id.split('.').slice(0, 2).join('.').replace(/_/g, ' ');
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-wh-text-secondary truncate max-w-[140px]">{indicator.label_low}</span>
        <span className="text-wh-text-tertiary">{label}</span>
        <span className="text-wh-text-secondary truncate max-w-[140px] text-right">{indicator.label_high}</span>
      </div>
      <div className="relative h-2 rounded-full bg-wh-border/40">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-wh-accent-teal/60"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded bg-wh-accent-teal"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-wh-text-tertiary">
        <span>{indicator.evidence_count} evidence</span>
        <span>{(indicator.confidence * 100).toFixed(0)}% conf</span>
      </div>
    </div>
  );
}
