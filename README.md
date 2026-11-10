# Fieldnote

Fieldnote is an installable, mobile-first carbon footprint estimator. It combines a chosen location's national electricity-grid factor with a few personal activity inputs.

## Run locally

Install Node.js, then run:

```sh
npm start
```

Open [http://localhost:4173](http://localhost:4173). GPS location requires a secure context; `localhost` works for local development. For phone use, host the folder over HTTPS, open it in the phone's browser, then choose **Add to Home Screen** or **Install app**.

## What it estimates

- Home electricity is divided by the number of people sharing the bill and multiplied by the selected country's grid-generation lifecycle factor.
- Petrol, diesel, and hybrid driving use average 2026 UK government conversion factors as reference values. Electric driving uses 0.18 kWh/km and the selected location's grid factor.
- Flights use average 2026 UK government passenger-kilometre factors, typical short- and long-haul return distances, and include aviation effects.
- Food uses editable starter assumptions of 1.3 tonnes/year for plant-forward, 2.1 tonnes/year for a mixed diet, and 3.1 tonnes/year for meat most days.

The result is a directional estimate for the activities shown. It is not a full emissions inventory: heating fuels, public transport, shopping, services, shared-vehicle occupancy, and other personal factors are not included. Grid intensity is a country-level average, not a street-level measurement. Where recent country data is unavailable, the app labels its use of the world average.

## Data, attribution, and privacy

- Place search uses [Open-Meteo's Geocoding API](https://open-meteo.com/en/docs/geocoding-api), with location data based on GeoNames.
- Grid intensity uses [Ember Yearly Electricity Data](https://ember-energy.org/data/yearly-electricity-data/) through the [Carbon Data API](https://carbondata.dev/docs/reference/). The app chooses the latest year meeting a 90% country-coverage threshold, then uses an earlier country value when needed. Carbon Data publishes source, license, and attribution details with its dataset.
- Road and air reference factors are from the [UK Government's 2026 greenhouse-gas reporting conversion factors](https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026). The app uses UK average factors as a transparent reference for transport outside the grid calculation.
- Alpha-2 to alpha-3 country-code lookup is bundled from the [staticdata.dev countries dataset](https://staticdata.dev/datasets/countries/).
- After the user taps **Detect my area**, the browser's live coordinates go directly to [BigDataCloud's free client-side reverse-geocoding endpoint](https://www.bigdatacloud.com/docs/api-domains). Searching by place name uses Open-Meteo instead.
- Calculator entries and public grid factors are saved in local storage. GPS coordinates are not stored by Fieldnote.

## Files

- `index.html`, `styles.css`, and `app.js` make up the app.
- `manifest.webmanifest`, `service-worker.js`, and `icon.svg` enable installability and shell caching.
- `server.mjs` is a dependency-free local development server.
