import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
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
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ema9SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema21SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const hasFittedRef = useRef(false);

  const matchedData =
    chartData && chartData.symbol === symbol && chartData.interval === interval
      ? chartData
      : null;

  // Effect 1: Initialize chart ONLY when symbol, interval, or height changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    hasFittedRef.current = false;
    priceLinesRef.current = [];

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#080C14' },
        textColor: '#94A3B8',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#131C2E' },
        horzLines: { color: '#131C2E' },
      },
      crosshair: {
        vertLine: { color: '#334155', labelBackgroundColor: '#1E293B' },
        horzLine: { color: '#334155', labelBackgroundColor: '#1E293B' },
      },
      rightPriceScale: {
        borderColor: '#1E293B',
        scaleMargins: { top: 0.06, bottom: 0.28 },
      },
      timeScale: {
        borderColor: '#1E293B',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 10,
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
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
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

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    ema9SeriesRef.current = ema9Series;
    ema21SeriesRef.current = ema21Series;
    ema50SeriesRef.current = ema50Series;

    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) {
        chart.applyOptions({ width: el.clientWidth });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      ema9SeriesRef.current = null;
      ema21SeriesRef.current = null;
      ema50SeriesRef.current = null;
      priceLinesRef.current = [];
    };
  }, [symbol, interval, height]);

  // Effect 2: Update candle/EMA data WITHOUT destroying chart or resetting user pan/zoom
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const ema9Series = ema9SeriesRef.current;
    const ema21Series = ema21SeriesRef.current;
    const ema50Series = ema50SeriesRef.current;

    if (
      !chart ||
      !candleSeries ||
      !volumeSeries ||
      !ema9Series ||
      !ema21Series ||
      !ema50Series ||
      !matchedData ||
      matchedData.candles.length === 0
    ) {
      return;
    }

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

    if (!hasFittedRef.current) {
      chart.timeScale().fitContent();
      hasFittedRef.current = true;
    }
  }, [matchedData]);

  // Effect 3: Update active position SL/TP/Entry lines cleanly without resetting chart scroll
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;

    for (const line of priceLinesRef.current) {
      try {
        candleSeries.removePriceLine(line);
      } catch {
        // Ignore if chart already recreated
      }
    }
    priceLinesRef.current = [];

    if (activePosition && activePosition.symbol === symbol && matchedData) {
      priceLinesRef.current.push(
        candleSeries.createPriceLine({
          price: activePosition.entryPrice,
          color: '#38BDF8',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'ENTRY',
        }),
        candleSeries.createPriceLine({
          price: activePosition.stopLoss,
          color: '#F43F5E',
          lineWidth: 1,
          lineStyle: 0,
          axisLabelVisible: true,
          title: activePosition.trailingActive ? 'TSL' : 'SL',
        }),
        candleSeries.createPriceLine({
          price: activePosition.takeProfit1,
          color: '#10B981',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'TP1',
        }),
        candleSeries.createPriceLine({
          price: activePosition.takeProfit2,
          color: '#34D399',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'TP2',
        }),
        candleSeries.createPriceLine({
          price: activePosition.takeProfit3 ?? activePosition.takeProfit2,
          color: '#6EE7B7',
          lineWidth: 1,
          lineStyle: 0,
          axisLabelVisible: true,
          title: 'TP3',
        }),
      );
    }
  }, [
    symbol,
    interval,
    Boolean(matchedData),
    activePosition?.entryPrice,
    activePosition?.stopLoss,
    activePosition?.takeProfit1,
    activePosition?.takeProfit2,
    activePosition?.takeProfit3,
    activePosition?.trailingActive,
  ]);

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
        <button
          type="button"
          onClick={() => chartRef.current?.timeScale().fitContent()}
          className="absolute top-2.5 left-2.5 z-10 rounded border border-slate-700/80 bg-[#0E1420]/90 px-2 py-1 text-[10px] font-semibold text-slate-300 backdrop-blur transition hover:border-cyan-500/50 hover:text-cyan-300"
          title="Kembalikan posisi grafik ke candle terbaru"
        >
          Reset View
        </button>
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}
