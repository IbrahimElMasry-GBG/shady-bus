/**
 * `tz-lookup` ships no TypeScript types. It exports a single function that maps
 * a coordinate to an IANA timezone name and throws on out-of-range input.
 */
declare module 'tz-lookup' {
  export default function tzLookup(latitude: number, longitude: number): string;
}
