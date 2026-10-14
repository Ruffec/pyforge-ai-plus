import React from 'react';

/**
 * 温度刻度滑条：
 * - 渐变填充轨道 + 高对比圆形滑块（替代原单一绿点）；
 * - 0 / 0.5 / 1.0 / 1.5 / 2.0 五档刻度标识与分段语义提示；
 * - 当前数值所处分段高亮，拖动即时反馈（过渡 ≤ 200ms）。
 * 纯展示组件：数值与变更回调由外部受控，便于复用与单测。
 */

const TEMPERATURE_SEGMENTS = [
  { max: 0.5, label: '精确', hint: '结果稳定、确定性强' },
  { max: 1.0, label: '均衡', hint: '兼顾稳定与多样性' },
  { max: 1.5, label: '发散', hint: '输出更具创造性' },
  { max: 2.0, label: '创意', hint: '随机性最高' },
] as const;

const TEMPERATURE_TICKS = [0, 0.5, 1.0, 1.5, 2.0] as const;

export interface TemperatureSliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const TemperatureSlider: React.FC<TemperatureSliderProps> = ({
  value,
  min = 0,
  max = 2,
  step = 0.1,
  disabled = false,
  onChange,
}) => {
  const percent = ((clamp(value, min, max) - min) / (max - min)) * 100;
  const activeSegment =
    TEMPERATURE_SEGMENTS.find((seg) => value <= seg.max) ?? TEMPERATURE_SEGMENTS[TEMPERATURE_SEGMENTS.length - 1];

  return (
    <div className="w-full max-w-[260px]">
      {/* 滑轨：渐变填充 + 自定义滑块（含数值气泡） */}
      <div className="relative flex items-center">
        <div className="pointer-events-none absolute inset-x-0 h-2 overflow-hidden rounded-full bg-pf-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-pf-primary via-state-success to-state-warning transition-[width] duration-200 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label="温度"
          aria-valuetext={`${value.toFixed(1)}，${activeSegment.label}`}
          onChange={(e) => onChange(clamp(parseFloat(e.target.value), min, max))}
          className="pf-range-slider relative z-10 h-6 w-full cursor-pointer appearance-none bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-pf-ring disabled:cursor-not-allowed"
        />
      </div>

      {/* 刻度标识：与 0/0.5/1.0/1.5/2.0 对齐 */}
      <div className="relative mt-1 h-3">
        {TEMPERATURE_TICKS.map((tick) => {
          const left = ((tick - min) / (max - min)) * 100;
          const reached = value >= tick - 1e-6;
          return (
            <span
              key={tick}
              className={`absolute top-0 h-3 w-px -translate-x-1/2 transition-colors duration-200 ${
                reached ? 'bg-pf-primary/70' : 'bg-pf-border'
              }`}
              style={{ left: `${left}%` }}
            />
          );
        })}
      </div>

      {/* 数值刻度行 */}
      <div className="mt-0.5 flex justify-between text-[10px] font-medium tabular-nums text-pf-muted-foreground">
        {TEMPERATURE_TICKS.map((tick) => (
          <span key={tick} className={value >= tick - 1e-6 ? 'text-pf-primary' : undefined}>
            {tick.toFixed(1)}
          </span>
        ))}
      </div>

      {/* 分段语义提示：当前所处区间高亮 */}
      <div className="mt-1.5 flex gap-1">
        {TEMPERATURE_SEGMENTS.map((seg) => {
          const active = seg.label === activeSegment.label;
          return (
            <span
              key={seg.label}
              title={seg.hint}
              className={`flex-1 rounded-md border px-1 py-0.5 text-center text-[10px] transition-colors duration-200 ${
                active
                  ? 'border-pf-primary/40 bg-pf-primary/10 font-semibold text-pf-primary'
                  : 'border-pf-border bg-pf-muted/40 text-pf-muted-foreground'
              }`}
            >
              {seg.label}
            </span>
          );
        })}
      </div>
      <p className="mt-1 text-right text-[10px] text-pf-muted-foreground">
        当前 {value.toFixed(1)} · {activeSegment.label}（{activeSegment.hint}）
      </p>
    </div>
  );
};
