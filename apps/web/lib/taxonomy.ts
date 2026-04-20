// Single source of truth for taxonomy slugs + display labels used by the
// aggregator pages (/vibes, /neighborhoods, /types). Keep slugs URL-safe and
// stable — they're indexed.

export const VIBES = [
  { slug: 'romantic',     label: 'Romantic',     blurb: 'Sunset-light, slow dinners, the kind of plan you think about for days.' },
  { slug: 'chill',        label: 'Chill',        blurb: 'Low effort, high signal. The night runs itself.' },
  { slug: 'adventurous',  label: 'Adventurous',  blurb: 'Earn the view. Then the beer.' },
  { slug: 'boujee',       label: 'Boujee',       blurb: 'Worth the organizing. Worth the spend.' },
  { slug: 'cozy',         label: 'Cozy',         blurb: 'Rain, candlelight, the good bistro.' },
  { slug: 'spontaneous',  label: 'Spontaneous',  blurb: "No plan survives the first drink — and that's the point." },
  { slug: 'lively',       label: 'Lively',       blurb: 'Loud rooms, full tables, energy you can ride.' },
  { slug: 'intimate',     label: 'Intimate',     blurb: 'Two seats at a marble bar. The world fades out.' },
  { slug: 'cultural',     label: 'Cultural',     blurb: 'Galleries, theatre, the kind of night with stories afterward.' },
] as const;

export const NEIGHBORHOODS = [
  { slug: 'downtown',           label: 'Downtown',            blurb: 'The waterfront, Bernard Avenue, the bridge views.' },
  { slug: 'lower-mission',      label: 'Lower Mission',       blurb: 'Lake-adjacent, leafy, more residential than downtown.' },
  { slug: 'upper-mission',      label: 'Upper Mission',       blurb: 'Higher up, quieter, the parks and viewpoints.' },
  { slug: 'pandosy',            label: 'Pandosy',             blurb: 'Walkable strip with cafes and shops, between downtown and Mission.' },
  { slug: 'rutland',            label: 'Rutland',             blurb: 'East side, off the beaten path, surprising spots.' },
  { slug: 'glenmore',           label: 'Glenmore',            blurb: 'North of downtown, where the city meets the mountain.' },
  { slug: 'west-kelowna',       label: 'West Kelowna',        blurb: 'Across the bridge — the wineries, the West Side bluffs.' },
  { slug: 'lake-country',       label: 'Lake Country',        blurb: 'North of the city, vineyards and quieter lakeshores.' },
  { slug: 'peachland',          label: 'Peachland',           blurb: 'South along the lake, smaller-town feel.' },
  { slug: 'lakeshore',          label: 'Lakeshore',           blurb: 'Right on the water, wherever that takes you.' },
  { slug: 'south-east-kelowna', label: 'South East Kelowna',  blurb: 'Orchards, ranches, and the trails up Myra.' },
] as const;

export const PLACE_TYPES = [
  { slug: 'restaurant',    label: 'Restaurants',     dbValue: 'restaurant' },
  { slug: 'cafe',          label: 'Cafes',           dbValue: 'cafe' },
  { slug: 'winery',        label: 'Wineries',        dbValue: 'winery' },
  { slug: 'brewery',       label: 'Breweries',       dbValue: 'brewery' },
  { slug: 'cocktail-bar',  label: 'Cocktail Bars',   dbValue: 'cocktail_bar' },
  { slug: 'bakery',        label: 'Bakeries',        dbValue: 'bakery' },
  { slug: 'dessert',       label: 'Dessert Spots',   dbValue: 'dessert' },
  { slug: 'ice-cream',     label: 'Ice Cream',       dbValue: 'ice_cream' },
  { slug: 'hike',          label: 'Hikes',           dbValue: 'hike' },
  { slug: 'walk',          label: 'Walks',           dbValue: 'walk' },
  { slug: 'park',          label: 'Parks',           dbValue: 'park' },
  { slug: 'beach',         label: 'Beaches',         dbValue: 'beach' },
  { slug: 'viewpoint',     label: 'Viewpoints',      dbValue: 'viewpoint' },
  { slug: 'sunset-spot',   label: 'Sunset Spots',    dbValue: 'sunset_spot' },
  { slug: 'garden',        label: 'Gardens',         dbValue: 'garden' },
  { slug: 'gallery',       label: 'Galleries',       dbValue: 'gallery' },
  { slug: 'market',        label: 'Markets',         dbValue: 'market' },
  { slug: 'shop',          label: 'Shops',           dbValue: 'shop' },
  { slug: 'activity',      label: 'Activities',      dbValue: 'activity' },
] as const;

// neighborhood db value (snake_case) → URL slug (kebab-case)
export function neighborhoodToSlug(db: string): string {
  return db.replace(/_/g, '-');
}
export function neighborhoodFromSlug(slug: string): string {
  return slug.replace(/-/g, '_');
}

export function findVibe(slug: string) {
  return VIBES.find((v) => v.slug === slug);
}
export function findNeighborhood(slug: string) {
  return NEIGHBORHOODS.find((n) => n.slug === slug);
}
export function findPlaceType(slug: string) {
  return PLACE_TYPES.find((t) => t.slug === slug);
}
