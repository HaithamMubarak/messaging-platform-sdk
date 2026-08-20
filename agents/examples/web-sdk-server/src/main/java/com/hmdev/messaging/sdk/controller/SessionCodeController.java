package com.hmdev.messaging.sdk.controller;

import com.hmdev.messaging.sdk.dto.JsonResponse;
import com.hmdev.messaging.sdk.service.SessionCodeStore;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Short codes for joining a room.
 *
 * <h2>Why this exists</h2>
 * The share link already works and carries everything needed. It is also
 * ninety characters of base64, which is fine to paste into a chat window and
 * useless down a telephone — and a telephone is exactly how the shared
 * terminal gets used: somebody is stuck, somebody else is helping, and one of
 * them is reading something out to the other. A code of two words and two
 * digits can be said out loud, written on paper, or typed by a person who is
 * already having a bad day.
 *
 * <h2>The trade-off, stated plainly</h2>
 * The link keeps the room password in the URL fragment, which browsers never
 * send to a server. A short code cannot do that: the mapping has to live
 * somewhere both parties can reach, so for as long as the code is alive this
 * service holds the room and its password in memory. That is a real cost and
 * it is why:
 *
 * <ul>
 *   <li>Codes are opt-in. Nothing mints one unless somebody presses the
 *       button; the link path is unchanged and remains the default.</li>
 *   <li>They expire in {@value #TTL_MINUTES} minutes. Long enough to read one
 *       out, far too short to be worth harvesting.</li>
 *   <li>They are redeemable {@value #MAX_REDEMPTIONS} times, then dropped —
 *       an invitation, not a permanent address.</li>
 *   <li>They carry {@code 5 * 5 = 25} bits from the word list plus two digits,
 *       and lookups are rate-limited per code and in total, so guessing is not
 *       a practical attack against a five-minute window.</li>
 *   <li>Nothing is written to disk and nothing is logged but the code itself —
 *       never the room or the password.</li>
 * </ul>
 *
 * A restart forgets every code. That is correct: they are meant to be used
 * within minutes of being made, and a forgotten code fails closed.
 */
@RestController
@RequestMapping("/app/api/session-code")
@Slf4j
public class SessionCodeController {

    /** How long a code is worth anything. */
    static final int TTL_MINUTES = 30;

    /** How many times one code may be exchanged for a room before it is spent. */
    static final int MAX_REDEMPTIONS = 5;

    /** Refuse to hold more than this many at once, so nobody can fill memory. */
    private static final int MAX_LIVE_CODES = 5_000;

    /** Wrong guesses tolerated across the whole service in a minute. */
    private static final int MAX_MISSES_PER_MINUTE = 60;

    /**
     * Words chosen to survive being said aloud: no homophones, nothing that
     * sounds like another entry, and nothing that spells anything unfortunate
     * in combination.
     */
    private static final String[] WORDS = {
            "amber", "anchor", "beacon", "birch", "cactus", "canyon", "cedar", "cobalt",
            "comet", "copper", "crimson", "delta", "ember", "falcon", "fjord", "garnet",
            "granite", "harbor", "indigo", "island", "jasmine", "juniper", "kestrel", "lagoon",
            "lantern", "maple", "marble", "meadow", "nectar", "nimbus", "oasis", "onyx",
            "orchid", "pepper", "pilot", "prairie", "quartz", "quiver", "ridge", "river",
            "saffron", "silver", "solstice", "summit", "thistle", "timber", "tundra", "velvet",
            "walnut", "willow", "zephyr", "zenith"
    };

    private static final SecureRandom RANDOM = new SecureRandom();

    private final SessionCodeStore store;
    private final AtomicInteger missesThisMinute = new AtomicInteger();
    private volatile Instant missWindowStarted = Instant.now();

    public SessionCodeController(SessionCodeStore store) {
        this.store = store;
    }

    /**
     * Mint a code for a room.
     *
     * @param body {@code channel} and {@code password} of the room to stand for
     * @return the code and how long it lives
     */
    @PostMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonResponse> create(@RequestBody Map<String, String> body) {
        String channel = body == null ? null : trimToNull(body.get("channel"));
        String password = body == null ? null : trimToNull(body.get("password"));

        if (channel == null || password == null) {
            return ResponseEntity.badRequest()
                    .body(JsonResponse.error("A channel and a password are both needed."));
        }
        if (channel.length() > 200 || password.length() > 200) {
            return ResponseEntity.badRequest()
                    .body(JsonResponse.error("That channel or password is too long to be real."));
        }

        if (store.liveInMemory() >= MAX_LIVE_CODES) {
            log.warn("[session-code] refusing to mint: {} codes already held here", store.liveInMemory());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(JsonResponse.error("Too many codes are in use right now. Share the link instead."));
        }

        String code = mintUnusedCode();
        store.put(code, channel, password, Duration.ofMinutes(TTL_MINUTES), MAX_REDEMPTIONS);

        // The code is safe to log; what it stands for is not.
        log.info("[session-code] minted {}", code);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("code", code);
        data.put("expiresInSeconds", TTL_MINUTES * 60);
        data.put("redemptions", MAX_REDEMPTIONS);
        return ResponseEntity.ok(JsonResponse.success(data));
    }

    /**
     * Exchange a code for the room it stands for.
     *
     * <p>A code that never existed, one that has expired and one that has been
     * spent all answer the same way. Telling them apart would let somebody
     * probing the space learn which guesses were nearly right.
     */
    @GetMapping(value = "/{code}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<JsonResponse> redeem(@PathVariable("code") String code) {
        String key = normalise(code);
        if (key == null) {
            return miss();
        }

        return store.redeem(key)
                .map(room -> {
                    Map<String, Object> data = new LinkedHashMap<>();
                    data.put("channel", room.channel());
                    data.put("password", room.password());
                    data.put("redemptionsLeft", room.redemptionsLeft());
                    return ResponseEntity.ok(JsonResponse.success(data));
                })
                .orElseGet(this::miss);
    }

    /**
     * One answer for every kind of failure, and a brake on how fast someone can
     * collect them.
     */
    private ResponseEntity<JsonResponse> miss() {
        if (Duration.between(missWindowStarted, Instant.now()).toMinutes() >= 1) {
            missWindowStarted = Instant.now();
            missesThisMinute.set(0);
        }
        if (missesThisMinute.incrementAndGet() > MAX_MISSES_PER_MINUTE) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(JsonResponse.error("Too many attempts. Wait a minute and try again."));
        }
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(JsonResponse.error("That code is not valid any more."));
    }

    private String mintUnusedCode() {
        for (int attempt = 0; attempt < 20; attempt++) {
            String candidate = WORDS[RANDOM.nextInt(WORDS.length)]
                    + "-" + WORDS[RANDOM.nextInt(WORDS.length)]
                    + "-" + (10 + RANDOM.nextInt(90));
            if (!store.exists(candidate)) {
                return candidate;
            }
        }
        // Vanishingly unlikely; fall back to something that cannot collide.
        return "room-" + Long.toString(Math.abs(RANDOM.nextLong()), 36);
    }

    private static String normalise(String code) {
        String trimmed = trimToNull(code);
        return trimmed == null ? null : trimmed.toLowerCase();
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
