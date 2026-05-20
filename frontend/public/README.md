# Static assets

## `ne_50m_admin_0_countries.geojson`

Source: <https://github.com/nvkelso/natural-earth-vector> path
`geojson/ne_50m_admin_0_countries.geojson`, public domain (Natural Earth).

Committed raw (~2.9 MB, ~600 KB gzipped). Served by Vite from `/public` at
the URL `/ne_50m_admin_0_countries.geojson`.

The ISO3 join key used everywhere in the frontend is
`feature.properties.ISO_A3_EH` (the "ISO_A3 with manual overrides" field).
Plain `ISO_A3` returns `"-99"` for several territories Natural Earth marks
as indeterminate (PSE, ESH, parts of Kashmir); `ISO_A3_EH` resolves those
to their commonly used ISO3 codes. App init throws if any iso3 in the
loaded fixture has no matching feature.

Disputed-border notes (spot-check after W4 first real run):

- ESH (Western Sahara) — Natural Earth shows it as separate from Morocco.
- Crimea — Natural Earth includes a feature overlapping Ukraine.
- TWN (Taiwan) — Natural Earth renders as separate; we accept that.
- Kashmir — Natural Earth has Indian/Pakistan-administered subfeatures.
- ISR / PSE — Natural Earth renders both as separate; fixture uses PSE.
