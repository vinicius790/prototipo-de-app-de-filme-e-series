import { API_TTL, isExpired, offlineStatus } from './offline.util';

describe('modo offline: regras', () => {
  it('isExpired vence pelo prazo e trata data ilegível como vencida', () => {
    const now = 1_800_000_000_000;
    expect(isExpired(String(now - 1000), now)).toBe(false);
    expect(isExpired(now - API_TTL, now)).toBe(false);
    expect(isExpired(now - API_TTL - 1, now)).toBe(true);
    for (const value of [null, '', 'ontem', undefined, Number.NaN]) {
      expect(isExpired(value, now)).toBe(true);
    }
  });

  it('offlineStatus fica vazio quando está tudo normal e explica os outros casos', () => {
    const cachedAt = new Date(2026, 4, 6, 7, 8).getTime();

    expect(offlineStatus({ online: true, cachedAt: null })).toBe('');
    expect(offlineStatus({ online: false, cachedAt: null })).toMatch(
      /^Você está offline\. Só o que foi aberto/,
    );
    expect(offlineStatus({ online: false, cachedAt })).toMatch(
      /^Você está offline\. Mostrando dados salvos em 06\/05\/2026.*07:08/,
    );
    expect(offlineStatus({ online: true, cachedAt })).toMatch(/^Sem resposta do TMDB\./);
  });
});
