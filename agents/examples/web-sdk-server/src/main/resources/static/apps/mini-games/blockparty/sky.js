/**
 * BlockParty — where the sun actually is
 *
 * The world knows exactly which piece of the Earth it is standing on, and the
 * clock knows what time it is there. That is everything needed to put the sun
 * in the right part of the sky: pin your world to your street in the evening
 * and the light comes from the west, low and orange, the way it does outside
 * the window. Nobody has to be told the time — the light says it.
 *
 * None of this is synchronised. Every client derives the same sun from the same
 * anchor and the same clock, so two players in one room see the same sky
 * without a byte crossing the wire.
 *
 * The position is the standard low-precision solar almanac: good to about a
 * hundredth of a degree, which is a great deal better than a sky made of
 * twenty-four triangles can show.
 *
 * One deliberate lie. A truthful 2am is a black screen, and a building game you
 * cannot see is a broken one, so the *lighting* never falls below a late blue
 * hour however far below the horizon the sun really is. The sun's direction
 * stays honest; only its brightness is floored — and the floor is set by what
 * you can still build in, not by what the almanac says. Night reads as night
 * because it is cold and blue, not because it is dark.
 */
(function () {
    'use strict';

    const RAD = Math.PI / 180, DEG = 180 / Math.PI;

    /**
     * Where the sun is, seen from a place at a moment.
     *
     * Returns its elevation above the horizon and its azimuth measured
     * clockwise from north, both in degrees.
     */
    function position(lat, lon, when) {
        const date = when || new Date();
        // Days since J2000.0, fractional. getTime() is UTC, which is what the
        // almanac wants — the local time zone never enters into it, because the
        // longitude already says where noon is.
        const d = (date.getTime() / 86400000) + 2440587.5 - 2451545.0;

        const meanLong = (280.460 + 0.9856474 * d) % 360;
        const meanAnom = ((357.528 + 0.9856003 * d) % 360) * RAD;
        // The Earth's orbit is an ellipse, so the sun runs ahead of and behind
        // its mean position over the year. These two terms are that wobble.
        const ecliptic = (meanLong + 1.915 * Math.sin(meanAnom)
            + 0.020 * Math.sin(2 * meanAnom)) * RAD;
        const obliquity = (23.439 - 0.0000004 * d) * RAD;

        const rightAsc = Math.atan2(Math.cos(obliquity) * Math.sin(ecliptic), Math.cos(ecliptic));
        const decl = Math.asin(Math.sin(obliquity) * Math.sin(ecliptic));

        // Sidereal time: which way the place is facing, relative to the stars.
        const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
        const lst = (gmst + lon / 15) * 15 * RAD;
        const hourAngle = lst - rightAsc;

        const phi = lat * RAD;
        const elevation = Math.asin(
            Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle));
        const azimuth = Math.atan2(
            -Math.sin(hourAngle),
            Math.tan(decl) * Math.cos(phi) - Math.sin(phi) * Math.cos(hourAngle));

        return {
            elevation: elevation * DEG,
            azimuth: ((azimuth * DEG) + 360) % 360
        };
    }

    /**
     * The sky, as a set of colours and intensities, keyed on how high the sun
     * is. Between the stops everything is interpolated, so an hour of dusk is
     * an hour of the sky changing rather than four sudden switches.
     */
    const STOPS = [
        // elev  zenith     horizon    key        keyI  hemiSky    hemiGround hemiI  expo
        [-90, '#060d1c', '#16233c', '#93a9cf', 0.38, '#31405f', '#20242f', 0.52, 1.14],
        [-6, '#081227', '#243659', '#aac0e2', 0.42, '#3b4d75', '#262b38', 0.58, 1.16],
        [0, '#14264f', '#c2703c', '#ff9d52', 0.64, '#495a80', '#2f2620', 0.52, 1.10],
        [6, '#173463', '#e0a05e', '#ffc489', 0.86, '#5b709f', '#372e22', 0.54, 1.08],
        [20, '#1d4c96', '#8fb0e2', '#fff0d2', 0.95, '#7d99d6', '#3a3226', 0.55, 1.10],
        [50, '#2a6fd0', '#aecbf2', '#fffaf0', 1.05, '#a8c4ff', '#3a3226', 0.58, 1.12]
    ];

    /** The floor: below this the lighting stops getting darker. */
    const NIGHT_FLOOR = -6;
    /** "Always daytime" pins the light here, wherever the sun really is. */
    const DAY_PIN = 35;

    function mix(a, b, t) {
        const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
        const ch = (sh) => Math.round((((pa >> sh) & 255) * (1 - t)) + (((pb >> sh) & 255) * t));
        return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
    }

    /**
     * Look the sky up for an elevation. `mode` is 'real' — the truth, floored
     * so the night stays playable — or 'day', which pins it to mid-afternoon
     * for people who came here to build rather than to watch the light.
     */
    function palette(elevation, mode) {
        let e = mode === 'day' ? DAY_PIN : Math.max(NIGHT_FLOOR, elevation);
        e = Math.max(STOPS[0][0], Math.min(STOPS[STOPS.length - 1][0], e));

        let i = 0;
        while (i < STOPS.length - 2 && e > STOPS[i + 1][0]) i++;
        const lo = STOPS[i], hi = STOPS[i + 1];
        const t = hi[0] === lo[0] ? 0 : (e - lo[0]) / (hi[0] - lo[0]);
        const num = (a, b) => a + (b - a) * t;

        return {
            zenith: mix(lo[1], hi[1], t),
            horizon: mix(lo[2], hi[2], t),
            key: mix(lo[3], hi[3], t),
            keyIntensity: num(lo[4], hi[4]),
            hemiSky: mix(lo[5], hi[5], t),
            hemiGround: mix(lo[6], hi[6], t),
            hemiIntensity: num(lo[7], hi[7]),
            exposure: num(lo[8], hi[8]),
            // Below the horizon it is night however the light is dressed, and
            // the UI should be able to say so.
            night: elevation < -6,
            dusk: elevation >= -6 && elevation < 6
        };
    }

    /**
     * A unit vector pointing at the sun, in world axes: +X east, +Y up, −Z
     * north — the same convention geo.js uses to place the world on the Earth.
     *
     * The elevation is floored well above the horizon whatever the hour. A key
     * light at or below ground level throws shadows the length of the world and
     * lights every face edge-on, so the truthful angle is kept for the compass
     * direction and softened for the geometry.
     */
    function direction(elevation, azimuth) {
        const e = Math.max(8, elevation) * RAD;
        const a = azimuth * RAD;
        return {
            x: Math.cos(e) * Math.sin(a),
            y: Math.sin(e),
            z: -Math.cos(e) * Math.cos(a)
        };
    }

    /** "the sun is 32° up in the south-west", for the UI. */
    function describe(elevation, azimuth) {
        const compass = ['north', 'north-east', 'east', 'south-east',
            'south', 'south-west', 'west', 'north-west'];
        const dir = compass[Math.round(azimuth / 45) % 8];
        if (elevation < -6) return 'night';
        if (elevation < 0) return `twilight, sun just below the ${dir} horizon`;
        return `sun ${Math.round(elevation)}° up in the ${dir}`;
    }

    window.BlockPartySky = { position, palette, direction, describe, NIGHT_FLOOR, DAY_PIN };
})();
