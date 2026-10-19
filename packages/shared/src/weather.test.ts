import { describe, expect, it } from 'vitest';
import { tripWeather } from './weather';

const answer = (body: unknown, status = 200) => {
  const urls: string[] = [];
  const fetch = async (url: string) => {
    urls.push(url);
    return { ok: status < 400, status, json: async () => body };
  };
  return { fetch, urls };
};

const daily = {
  timezone: 'Asia/Kolkata',
  daily: {
    time: ['2026-10-23', '2026-10-24'],
    weather_code: [61, null],
    temperature_2m_max: [31.6, 30],
    temperature_2m_min: [24.2, 23],
    precipitation_probability_max: [70, 20],
  },
};

const goa = { latitude: 15.3, longitude: 74.1 };

describe('trip weather', () => {
  it('asks for the forecast when the trip is within two weeks, skipping days with gaps', async () => {
    const { fetch, urls } = answer(daily);
    const w = await tripWeather(fetch, { ...goa, startDate: '2026-10-23', endDate: '2026-10-24' }, '2026-10-19');
    expect(urls[0]).toContain('api.open-meteo.com/v1/forecast');
    expect(w).toEqual({
      kind: 'forecast',
      timezone: 'Asia/Kolkata',
      days: [{ date: '2026-10-23', code: 61, maxC: 32, minC: 24, rainChance: 70, rainMm: null }],
    });
  });

  it("shows last year's weather, dated this year, for a trip further out", async () => {
    const { fetch, urls } = answer({
      timezone: 'Asia/Kolkata',
      daily: { time: ['2025-12-20'], weather_code: [0], temperature_2m_max: [33], temperature_2m_min: [21], precipitation_sum: [0] },
    });
    const w = await tripWeather(fetch, { ...goa, startDate: '2026-12-20', endDate: '2026-12-20' }, '2026-10-19');
    expect(urls[0]).toContain('archive-api.open-meteo.com');
    expect(urls[0]).toContain('start_date=2025-12-20');
    expect(w.kind).toBe('typical');
    expect(w.days[0]).toMatchObject({ date: '2026-12-20', rainChance: null, rainMm: 0 });
  });

  it('needs a place, and shows nothing once the trip is over', async () => {
    const { fetch, urls } = answer(daily);
    expect((await tripWeather(fetch, { latitude: null, longitude: null, startDate: '2026-10-23', endDate: '2026-10-24' }, '2026-10-19')).kind).toBe('none');
    expect((await tripWeather(fetch, { ...goa, startDate: '2026-10-01', endDate: '2026-10-05' }, '2026-10-19')).kind).toBe('none');
    expect(urls).toHaveLength(0);
  });

  it('shows the coming week for a trip without dates yet', async () => {
    const { fetch, urls } = answer(daily);
    await tripWeather(fetch, { ...goa, startDate: null, endDate: null }, '2026-10-19');
    expect(urls[0]).toContain('start_date=2026-10-19');
    expect(urls[0]).toContain('end_date=2026-10-25');
  });

  it('fails when Open-Meteo refuses, so the caller can fall back', async () => {
    const { fetch } = answer({}, 429);
    await expect(tripWeather(fetch, { ...goa, startDate: '2026-10-23', endDate: '2026-10-24' }, '2026-10-19')).rejects.toThrow(/429/);
  });
});
