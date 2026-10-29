// Genera la retícula de puntos de tierra para el mapa (se ejecuta al compilar).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geoContains } from 'd3-geo';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/land-110m.json'), 'utf8'));
const land = feature(topo, topo.objects.land) as any;
const STEP = 2.4;
const pts: [number, number][] = [];
for (let lat = 80; lat >= -58; lat -= STEP) {
  for (let lon = -180; lon < 180; lon += STEP) {
    if (geoContains(land, [lon, lat])) pts.push([Math.round(lon * 10) / 10, Math.round(lat * 10) / 10]);
  }
}
writeFileSync('web/public/mapa.json', JSON.stringify(pts));
console.log('puntos de tierra:', pts.length);
