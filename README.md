# Architecture:

A Cloudflare Worker – defined in `wrangler.toml`, triggered on hourly cron schedule. Runs `index.js`, a node.js script which fetches flight information and writes to a `flights.json` file in a public s3 bucket.

The Cloudflare Worker exposes the `public` directory as static assets. A browser loads `index.html` through that mechanism, which fetches the latest `flights.json` from the public s3 bucket as well as `airports.csv` (which we need to manually upload to the bucket).
