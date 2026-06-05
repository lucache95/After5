// Hand-built Foursquare `/places/search` result fixtures for unit tests.
// Mirrors the new-API response shape (FsqResult) so the mapper + pickHours +
// category + quality-floor tests run with NO live key and NO network.
//
// Shapes per 08-RESEARCH.md "Code Examples" / "Response fields":
//   - latitude/longitude are TOP-LEVEL (new API), not nested under geocodes.main
//   - hours.regular = [{ day: 1..7 (Mon..Sun), open: "HHMM", close: "HHMM" }]
//   - rating is already 0.0–10.0 (do NOT ×2)
//   - photos are { prefix, suffix } fragments (URL = prefix + size + suffix)

import type { FsqResult } from '../foursquare.ts';

// Full venue: hours (incl. Wednesday), coords, rating 8.4, price 2, a photo.
export const richVenue: FsqResult = {
  fsq_place_id: 'fsq-rich-001abc',
  name: 'The Salt Cellar',
  latitude: 49.8881,
  longitude: -119.4962,
  location: {
    address: '123 Bernard Ave',
    locality: 'Kelowna',
    region: 'BC',
    postcode: 'V1Y 6N2',
    formatted_address: '123 Bernard Ave, Kelowna, BC V1Y 6N2',
  },
  categories: [{ fsq_category_id: '4bf58dd8d48988d14e941735', name: 'Cocktail Bar' }],
  hours: {
    regular: [
      { day: 1, open: '1600', close: '2300' },
      { day: 3, open: '1100', close: '2200' }, // Wednesday — pickHours should choose this
      { day: 5, open: '1100', close: '0000' },
    ],
    display: 'Mon–Sun 11:00–22:00',
    open_now: true,
  },
  price: 2,
  rating: 8.4,
  popularity: 0.92,
  photos: [
    {
      prefix: 'https://fastly.4sqi.net/img/general/',
      suffix: '/123456_abcdef.jpg',
      width: 1920,
      height: 1080,
    },
  ],
  website: 'https://saltcellar.example.com',
  tel: '+1 250-555-0100',
};

// Hours undefined entirely → pickHours must yield {opens:null, closes:null}.
export const nullHoursVenue: FsqResult = {
  fsq_place_id: 'fsq-nullhours-002',
  name: 'Trailhead Lookout',
  latitude: 49.91,
  longitude: -119.45,
  location: { locality: 'Kelowna', formatted_address: 'Knox Mountain, Kelowna, BC' },
  categories: [{ fsq_category_id: '4bf58dd8d48988d159941735', name: 'Hiking Trail' }],
  hours: undefined,
  price: undefined,
  rating: 7.8,
  popularity: 0.6,
  photos: [],
  website: undefined,
};

// latitude/longitude undefined → fsqResultToPlaceRow must emit lat:null,lng:null (no crash).
export const nullCoordsVenue: FsqResult = {
  fsq_place_id: 'fsq-nullcoords-003',
  name: 'Mystery Cafe',
  latitude: undefined,
  longitude: undefined,
  location: { locality: 'Kelowna', formatted_address: 'Somewhere, Kelowna, BC' },
  categories: [{ fsq_category_id: '4bf58dd8d48988d1e0931735', name: 'Coffee Shop' }],
  hours: { regular: [{ day: 3, open: '0700', close: '1700' }] },
  price: 1,
  rating: 8.0,
  popularity: 0.5,
  photos: [],
};

// rating 5.0 (below the 7.0 floor) → passesQualityFloor must reject.
export const belowFloorVenue: FsqResult = {
  fsq_place_id: 'fsq-belowfloor-004',
  name: 'Meh Diner',
  latitude: 49.88,
  longitude: -119.49,
  location: { locality: 'Kelowna', formatted_address: '500 Main St, Kelowna, BC' },
  categories: [{ fsq_category_id: '4bf58dd8d48988d143941735', name: 'Diner' }],
  hours: { regular: [{ day: 3, open: '0800', close: '2000' }] },
  price: 2,
  rating: 5.0,
  popularity: 0.2,
  photos: [],
};
