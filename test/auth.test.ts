import { describe, expect, it, vi, beforeAll } from 'vitest';
import { verifyAccessJwt, can, subState, hasAccess } from '../src/worker/auth';

const env: any = { ACCESS_TEAM: 'equipo', ACCESS_AUD: 'aud-123' };
const b64u = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');
let priv: CryptoKey, otherPriv: CryptoKey;

async function sign(payload: object, key = priv, kid = 'k1') {
  const h = b64u(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid })));
  const p = b64u(new TextEncoder().encode(JSON.stringify(payload)));
  const s = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(s)}`;
}

beforeAll(async () => {
  const alg = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const kp = await crypto.subtle.generateKey(alg, true, ['sign', 'verify']) as CryptoKeyPair;
  const kp2 = await crypto.subtle.generateKey(alg, true, ['sign', 'verify']) as CryptoKeyPair;
  priv = kp.privateKey; otherPriv = kp2.privateKey;
  const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1' };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }))));
});

const ok = () => ({ aud: ['aud-123'], iss: 'https://equipo.cloudflareaccess.com', exp: Math.floor(Date.now() / 1000) + 600, email: 'Jack@Ejemplo.com' });

describe('Cloudflare Access', () => {
  it('acepta un token válido y normaliza el correo', async () => {
    expect(await verifyAccessJwt(await sign(ok()), env)).toBe('jack@ejemplo.com');
  });
  it('rechaza firma de otra clave', async () => {
    expect(await verifyAccessJwt(await sign(ok(), otherPriv), env)).toBeNull();
  });
  it('rechaza audiencia, emisor o caducidad incorrectos', async () => {
    expect(await verifyAccessJwt(await sign({ ...ok(), aud: ['otra'] }), env)).toBeNull();
    expect(await verifyAccessJwt(await sign({ ...ok(), iss: 'https://malo.cloudflareaccess.com' }), env)).toBeNull();
    expect(await verifyAccessJwt(await sign({ ...ok(), exp: 1 }), env)).toBeNull();
  });
  it('rechaza tokens manipulados', async () => {
    const t = await sign(ok());
    const [h, , s] = t.split('.');
    const p = b64u(new TextEncoder().encode(JSON.stringify({ ...ok(), email: 'admin@ejemplo.com' })));
    expect(await verifyAccessJwt(`${h}.${p}.${s}`, env)).toBeNull();
  });
});

describe('roles', () => {
  it('jerarquía de permisos', () => {
    const u = (role: any, estado: any = 'activo') => ({ email: 'a', name: null, role, estado, hasta: null, diasRestantes: null });
    expect(can(u('admin'), 'admin')).toBe(true);
    expect(can(u('analista'), 'admin')).toBe(false);
    expect(can(u('analista'), 'analista')).toBe(true);
    expect(can(u('lector'), 'analista')).toBe(false);
    expect(can(null, 'lector')).toBe(false);
    expect(can(u('analista', 'caducado'), 'analista')).toBe(false);
    expect(can(u('admin', 'admin'), 'admin')).toBe(true);
  });
});

describe('suscripciones', () => {
  const D = 864e5, t = Date.UTC(2026, 9, 29);
  it('prueba en curso, caducada, pagada y bloqueada', () => {
    expect(subState({ role: 'lector', active: 1, trial_until: t + 5 * D, paid_until: null }, t)).toMatchObject({ estado: 'prueba', diasRestantes: 5 });
    expect(subState({ role: 'lector', active: 1, trial_until: t - D, paid_until: null }, t)).toMatchObject({ estado: 'caducado', diasRestantes: 0 });
    expect(subState({ role: 'lector', active: 1, trial_until: t - D, paid_until: t + 300 * D }, t)).toMatchObject({ estado: 'activo', diasRestantes: 300 });
    expect(subState({ role: 'analista', active: 0, trial_until: t + D, paid_until: t + D }, t).estado).toBe('bloqueado');
    expect(subState({ role: 'admin', active: 1, trial_until: null, paid_until: null }, t).estado).toBe('admin');
  });
  it('solo admin, activos y en prueba tienen acceso', () => {
    const mk = (estado: any) => ({ email: 'a', name: null, role: 'lector' as const, estado, hasta: null, diasRestantes: null });
    expect(['admin', 'activo', 'prueba', 'caducado', 'bloqueado'].map((e) => hasAccess(mk(e)))).toEqual([true, true, true, false, false]);
    expect(hasAccess(null)).toBe(false);
  });
});
