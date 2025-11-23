import { FlightRadar24API } from "./lib/flightradarapi"; // Needed to slightly modify the library to run on the Cloudflare Worker runtime

/*
https://mapscaping.com/bounding-box-calculator/
lat1 long1
lat2 long2

lat1 lat2 long1 long2
*/

const geoBounds = {
    global: null,
    icelandGreenland: "82.818307,45.386109,-66.594433,-7.848665",
    canadaAlaska: "83.761557,50.558120,-211.131045,-71.126161",
    northPacific: "48.968682,23.628425,-213.571543,-125.980548",
    southPacific: "-77.281595,25.926439,-213.501958,-78.421869",
    indianOcean: "-60.552416,0.070317,44.136283,111.676328"
};

export default {
    async scheduled(controller, env, ctx) {
        console.log("Cron job triggered");
        const frApi = new FlightRadar24API();

        try {
            const flightArrays = await Promise.all(
                Object.keys(geoBounds).map((region) =>
                    frApi.getFlights(null, geoBounds[region], null, null)
                )
            );

            const allFlights = flightArrays.flat();

            console.log(
                `Total flights fetched (with duplicates): ${allFlights.length}`
            );

            const uniqueFlights = Array.from(
                new Map(
                    allFlights.map((flight) => [flight.id, flight])
                ).values()
            );

            const flightData = uniqueFlights.map((flight) => ({
                latitude: flight.latitude,
                longitude: flight.longitude,
                heading: flight.heading,
                altitude: flight.altitude,
                groundSpeed: flight.groundSpeed,
                aircraftCode: flight.aircraftCode,
                originAirportIata: flight.originAirportIata,
                destinationAirportIata: flight.destinationAirportIata,
                callsign: flight.callsign,
            }));

            const output = {
                timestamp: Math.floor(Date.now() / 1000), // Unix timestamp (seconds)
                flights: flightData,
            };

            console.log(
                `Total deduplicated flights found: ${uniqueFlights.length}`
            );

            await env.BUCKET.put(
                "flights.json",
                JSON.stringify(output, null, 2),
                {
                    httpMetadata: {
                        contentType: "application/json",
                    },
                }
            );

            console.log("Successfully updated flights.json");
        } catch (error) {
            console.error("Error in cron job:", error);
        }
    },
};
