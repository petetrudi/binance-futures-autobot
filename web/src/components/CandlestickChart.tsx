import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { CandleChartResponse, Position, Timeframe } from '@bot/shared';
import { fmtPrice } from '../lib/format.js';

interface CandlestickChartProps {
  symbol: string;
  interval: Timeframe;
  chartData: CandleChartResponse | null;
  loading: boolean;
  activePosition: Position | null;
  onIntervalChange: (interval: Timeframe) => void;
  hideHeader?: boolean;
  height?: number;
}

const TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h'];

export function CandlestickChart({
  symbol,
  interval,
  chartData,
  loading,
  activePosition,
  onIntervalChange,
  hideHeader = false,
  height = 390,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const matchedData = chartData && chartData.symbol === symbol ? chartData : null;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !matchedData || matchedData.candles.length === 0) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#0B111E' },
        textColor: '#94A3B8',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#151E30' },
        horzLines: { color: '#151E30' },
      },
      crosshair: {
        vertLine: { color: '#334155', labelBackgroundColor: '#1E293B' },
        horzLine: { color: '#334155', labelBackgroundColor: '#1E293B' },
      },
      rightPriceScale: {
        borderColor: '#1E293B',
      },
      timeScale: {
        borderColor: '#1E293B',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10B981',
      downColor: '#F43F5E',
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#F43F5E',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    const ema9Series = chart.addSeries(LineSeries, {
      color: '#22D3EE',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const ema21Series = chart.addSeries(LineSeries, {
      color: '#F59E0B',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const ema50Series = chart.addSeries(LineSeries, {
      color: '#A855F7',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    candleSeries.setData(
      matchedData.candles.map((c) => ({
        time: Math.floor(c.openTime / 1000) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    volumeSeries.setData(
      matchedData.candles.map((c) => ({
        time: Math.floor(c.openTime / 1000) as UTCTimestamp,
        value: c.volume,
        color:
          c.close >= c.open
            ? 'rgba(16, 185, 129, 0.28)'
            : 'rgba(244, 63, 94, 0.28)',
      })),
    );

    ema9Series.setData(
      matchedData.ema9.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
    );
    ema21Series.setData(
      matchedData.ema21.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
    );
    ema50Series.setData(
      matchedData.ema50.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
    );

    if (activePosition && activePosition.symbol === symbol) {
      candleSeries.createPriceLine({
        price: activePosition.entryPrice,
        color: '#38BDF8',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `ENTRY ${activePosition.side}`,
      });
      candleSeries.createPriceLine({
        price: activePosition.stopLoss,
        color: '#F43F5E',
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
        title: activePosition.trailingActive ? 'TRAIL SL' : 'SL',
      });
      candleSeries.createPriceLine({
        price: activePosition.takeProfit1,
        color: '#10B981',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'TP1',
      });
      candleSeries.createPriceLine({
        price: activePosition.takeProfit2,
        color: '#34D399',
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
        title: 'TP2',
      });
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) {
        chart.applyOptions({ width: el.clientWidth });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [matchedData, activePosition, height, symbol]);

  const lastCandle = matchedData?.candles.at(-1);
  const showLoader = loading || !matchedData || matchedData.candles.length === 0;

  return (
    <div
      className={
        hideHeader
          ? 'w-full'
          : 'rounded-xl border border-slate-800/90 bg-[#0E1420] p-4'
      }
    >
      {!hideHeader && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold tracking-wide text-slate-100">
              {symbol}
            </h2>
            {lastCandle && (
              <span className="font-mono-num text-sm font-semibold text-cyan-300">
                ${fmtPrice(lastCandle.close)}
              </span>
            )}
            <div className="hidden items-center gap-2 text-[11px] text-slate-400 sm:flex">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-cyan-400" /> EMA9
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-400" /> EMA21
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-purple-400" /> EMA50
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#080C14] p-1">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onIntervalChange(tf)}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
                  interval === tf
                    ? 'bg-cyan-500/20 text-cyan-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        className="relative w-full overflow-hidden rounded-lg border border-slate-800/80 bg-[#080C14]"
        style={{ height }}
      >
        {showLoader && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#080C14]/85 text-xs text-slate-400">
            Loading {symbol} {interval} realtime candles...
          </div>
        )}
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}
