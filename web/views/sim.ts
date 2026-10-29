import { callModel, S } from '../state';

const cache = new Map<string, Promise<any>>();
export function simulate(horizon: number, active: Record<string, number> = {}, extraVol = 0, level: number | null = null): Promise<any> {
  const key = JSON.stringify([S.model?.asOf, S.model?.price, horizon, active, extraVol.toFixed(3), level]);
  if (!cache.has(key)) {
    if (cache.size > 40) cache.clear();
    cache.set(key, callModel('simulate', { horizon, active, extraVol, level }));
  }
  return cache.get(key)!;
}
