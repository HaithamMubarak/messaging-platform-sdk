/**
 * BlockParty — places worth guessing.
 *
 * The board for "Where on Earth". Every entry has to survive being rendered as
 * a few thousand blocks at street scale, which rules out most of the planet:
 * what reads is a distinctive *shape* — a peninsula, a ring road, a river bend,
 * a grid that runs at a strange angle, a runway. A pretty building does not
 * survive the resolution; a coastline does.
 *
 * The hint is a fallback, not a clue: it is shown only once the guessing is
 * over, so a place nobody recognised still teaches you something.
 */
(function () {
    'use strict';

    // name, country, lat, lon, metres-per-block, hint
    const PLACES = [
        ['Manhattan', 'United States', 40.7580, -73.9855, 5, 'The grid runs 29° off north, which is why the sun sets down the streets twice a year.'],
        ['Venice', 'Italy', 45.4340, 12.3390, 2, 'No roads. The dark lines are water.'],
        ['Paris', 'France', 48.8738, 2.2950, 5, 'Twelve avenues meeting at one circle.'],
        ['Amsterdam', 'Netherlands', 52.3730, 4.8920, 2, 'Canals in half-rings around the old centre.'],
        ['Barcelona', 'Spain', 41.3930, 2.1620, 2, "Every block's corners are cut off — the Eixample grid."],
        ['Brasília', 'Brazil', -15.7940, -47.8820, 20, 'A city laid out in the shape of an aeroplane.'],
        ['Palm Jumeirah', 'United Arab Emirates', 25.1120, 55.1390, 5, 'An artificial island shaped like a palm tree.'],
        ['Hong Kong', 'China', 22.2830, 114.1580, 5, 'A harbour with mountains falling straight into it.'],
        ['Sydney', 'Australia', -33.8570, 151.2150, 2, 'A drowned river valley full of headlands.'],
        ['Rio de Janeiro', 'Brazil', -22.9710, -43.1820, 5, 'Beaches between granite peaks.'],
        ['Istanbul', 'Turkey', 41.0200, 28.9740, 5, 'A strait dividing two continents.'],
        ['Copenhagen', 'Denmark', 55.6870, 12.5860, 2, 'Water everywhere and almost no hills.'],
        ['Stockholm', 'Sweden', 59.3270, 18.0710, 5, 'A city built across fourteen islands.'],
        ['Reykjavík', 'Iceland', 64.1470, -21.9400, 5, 'The northernmost capital of a sovereign state.'],
        ['San Francisco', 'United States', 37.8080, -122.4180, 5, 'A grid that ignores some very steep hills.'],
        ['Chicago', 'United States', 41.8820, -87.6230, 5, 'A perfectly regular grid meeting a freshwater sea.'],
        ['New Orleans', 'United States', 29.9560, -90.0660, 5, 'A city inside a bend of the Mississippi.'],
        ['Toronto', 'Canada', 43.6420, -79.3870, 5, 'A grid on a lake, with islands just offshore.'],
        ['Mexico City', 'Mexico', 19.4340, -99.1330, 20, 'Built on the bed of a drained lake.'],
        ['Havana', 'Cuba', 23.1400, -82.3560, 5, 'A narrow harbour mouth guarded by two forts.'],
        ['Buenos Aires', 'Argentina', -34.6080, -58.3700, 20, 'On the widest river estuary in the world.'],
        ['Cape Town', 'South Africa', -33.9250, 18.4230, 5, 'A flat-topped mountain behind a bowl of streets.'],
        ['Cairo', 'Egypt', 30.0450, 31.2350, 20, 'A river with desert on both sides of the green.'],
        ['Giza', 'Egypt', 29.9790, 31.1340, 2, 'Three very large triangles.'],
        ['Marrakesh', 'Morocco', 31.6300, -7.9890, 5, 'A walled medina with no straight streets at all.'],
        ['Lagos', 'Nigeria', 6.4550, 3.4210, 20, 'A lagoon city on the Bight of Benin.'],
        ['Nairobi', 'Kenya', -1.2860, 36.8170, 20, 'A capital with a national park on its edge.'],
        ['Dubai', 'United Arab Emirates', 25.1970, 55.2740, 5, 'A creek, then towers, then desert.'],
        ['Jerusalem', 'Israel', 31.7770, 35.2340, 2, 'A walled old city split into four quarters.'],
        ['Mumbai', 'India', 18.9400, 72.8350, 5, 'A peninsula that used to be seven islands.'],
        ['Jaipur', 'India', 26.9240, 75.8260, 5, 'A planned city on a nine-square grid.'],
        ['Bangkok', 'Thailand', 13.7520, 100.4930, 5, 'Loops of river through a very flat delta.'],
        ['Singapore', 'Singapore', 1.2830, 103.8510, 5, 'An island city at the end of a peninsula.'],
        ['Kyoto', 'Japan', 35.0110, 135.7680, 5, 'A grid in a valley, copied from a Chinese capital.'],
        ['Tokyo', 'Japan', 35.6800, 139.7690, 5, 'A bay, a palace moat, and no grid at all.'],
        ['Seoul', 'South Korea', 37.5720, 126.9770, 5, 'A river through the middle, mountains on every side.'],
        ['Shanghai', 'China', 31.2380, 121.4900, 5, 'A river bend with a colonial waterfront on one side.'],
        ['Beijing', 'China', 39.9160, 116.3970, 5, 'Concentric ring roads around a rectangle.'],
        ['Moscow', 'Russia', 55.7520, 37.6180, 5, 'A fortress triangle on a river, ring roads around it.'],
        ['Saint Petersburg', 'Russia', 59.9390, 30.3160, 5, 'Canals and islands at the head of a gulf.'],
        ['Athens', 'Greece', 37.9720, 23.7260, 2, 'A rock with temples on it, in the middle of a basin.'],
        ['Rome', 'Italy', 41.8900, 12.4920, 2, 'An oval amphitheatre and a river shaped like an S.'],
        ['Lisbon', 'Portugal', 38.7100, -9.1400, 5, 'Hills above a river so wide it looks like sea.'],
        ['Edinburgh', 'United Kingdom', 55.9490, -3.1900, 2, 'A castle on a crag, a planned grid beside it.'],
        ['London', 'United Kingdom', 51.5070, -0.1200, 5, 'A river with a very sharp loop around a peninsula.'],
        ['Berlin', 'Germany', 52.5170, 13.3890, 5, 'A park in the middle and a river through it.'],
        ['Vienna', 'Austria', 48.2080, 16.3730, 5, 'A ring road where the city walls used to be.'],
        ['Machu Picchu', 'Peru', -13.1630, -72.5450, 2, 'Terraces on a ridge between two peaks.'],
        ['Grand Canyon', 'United States', 36.0990, -112.1120, 100, 'A very large hole.'],
        ['Uluru', 'Australia', -25.3450, 131.0360, 20, 'One rock, in the middle of a continent.']
    ];

    function all() {
        return PLACES.map((p, i) => ({
            id: 'p' + i, name: p[0], country: p[1],
            lat: p[2], lon: p[3], mpc: p[4], hint: p[5]
        }));
    }

    /** One place, avoiding the ones this match has already used. */
    function pick(exclude) {
        const list = all();
        const pool = list.filter(p => (exclude || []).indexOf(p.id) === -1);
        const from = pool.length ? pool : list;
        return from[Math.floor(Math.random() * from.length)];
    }

    function byId(id) { return all().find(p => p.id === id) || null; }

    /**
     * How far apart two points are, in kilometres. The great-circle distance,
     * because a guess on the far side of the planet is the whole point of the
     * mode and a flat approximation would score it wrongly.
     */
    function distanceKm(a, b) {
        const R = 6371;
        const rad = Math.PI / 180;
        const dLat = (b.lat - a.lat) * rad;
        const dLon = (b.lon - a.lon) * rad;
        const s = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(a.lat * rad) * Math.cos(b.lat * rad)
              * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return Math.round(2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
    }

    /**
     * Points for a guess, on a log scale.
     *
     * Linear scoring makes every guess that is not nearly perfect worth the
     * same nothing, which kills the game for everyone who is merely in the
     * right country. Within 25km is full marks; the score then falls away by
     * distance, and being on the right continent is still worth something.
     */
    function score(km) {
        if (km <= 25) return 100;
        if (km >= 12000) return 0;
        const t = Math.log10(km / 25) / Math.log10(12000 / 25);
        return Math.max(0, Math.round(100 * (1 - t)));
    }

    window.BlockPartyPlaces = { all, pick, byId, distanceKm, score };
})();
