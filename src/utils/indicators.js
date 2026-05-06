/**
 * Technical Indicator Calculations for Lightweight Charts
 */

export function calculateSMA(data, period) {
  const sma = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      continue;
    }
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    sma.push({ time: data[i].time, value: sum / period });
  }
  return sma;
}

export function calculateEMA(data, period) {
  const ema = [];
  const k = 2 / (period + 1);
  let prevEma = data[0].close;

  for (let i = 0; i < data.length; i++) {
    const val = (data[i].close - prevEma) * k + prevEma;
    if (i >= period - 1) {
      ema.push({ time: data[i].time, value: val });
    }
    prevEma = val;
  }
  return ema;
}

export function calculateRSI(data, period = 14) {
  const rsi = [];
  let gains = 0;
  let losses = 0;

  for (let i = 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (diff >= 0) {
      gains += diff;
    } else {
      losses -= diff;
    }

    if (i >= period) {
      if (i > period) {
        const prevDiff = data[i - 1].close - data[i - 2].close;
        // This is a simplified RSI calculation, usually it uses Wilder's Smoothing
      }
      
      const avgGain = gains / period;
      const avgLoss = losses / period;
      
      if (avgLoss === 0) {
        rsi.push({ time: data[i].time, value: 100 });
      } else {
        const rs = avgGain / avgLoss;
        rsi.push({ time: data[i].time, value: 100 - 100 / (1 + rs) });
      }

      // Roll windows
      const oldDiff = data[i - period + 1].close - data[i - period].close;
      if (oldDiff >= 0) gains -= oldDiff;
      else losses += oldDiff;
    }
  }
  return rsi;
}

export function calculateBollingerBands(data, period = 20, stdDev = 2) {
  const upper = [];
  const middle = [];
  const lower = [];

  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    const avg = sum / period;

    let variance = 0;
    for (let j = 0; j < period; j++) {
      variance += Math.pow(data[i - j].close - avg, 2);
    }
    const sd = Math.sqrt(variance / period);

    middle.push({ time: data[i].time, value: avg });
    upper.push({ time: data[i].time, value: avg + stdDev * sd });
    lower.push({ time: data[i].time, value: avg - stdDev * sd });
  }

  return { upper, middle, lower };
}
