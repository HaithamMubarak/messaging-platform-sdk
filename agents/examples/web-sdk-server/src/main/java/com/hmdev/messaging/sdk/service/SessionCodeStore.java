package com.hmdev.messaging.sdk.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Where a short code's meaning is kept.
 *
 * <p>Two implementations behind one door. In memory is the default and is
 * right for a single instance: nothing to configure, nothing else to run, and
 * a restart forgets every code — which is safe, because a forgotten code fails
 * closed and these are meant to be used within minutes of being made.
 *
 * <p>That default breaks in exactly two situations, and both are real:
 * a restart during someone's support call loses the code they were about to
 * read out, and a second instance of this service cannot resolve a code the
 * first one minted. Point {@code SESSION_CODE_REDIS} at the Redis the platform
 * already runs and both go away — the store becomes shared, and the expiry
 * becomes Redis's own rather than a sweep.
 *
 * <p>Redis is used through {@link StringRedisTemplate} only if a template bean
 * exists and the flag is on. If Redis is unreachable at the moment a code is
 * minted or redeemed, this falls back to memory for that call rather than
 * failing the request: a short code is a convenience, and the share link is
 * always there underneath it.
 */
@Component
@Slf4j
public class SessionCodeStore {

    private static final String KEY_PREFIX = "sdk:session-code:";

    /** What a code stands for. Kept small: it is written to Redis as a string. */
    public static final class Room {
        private final String channel;
        private final String password;
        private final int redemptionsLeft;

        Room(String channel, String password, int redemptionsLeft) {
            this.channel = channel;
            this.password = password;
            this.redemptionsLeft = redemptionsLeft;
        }

        public String channel() { return channel; }
        public String password() { return password; }
        public int redemptionsLeft() { return redemptionsLeft; }
    }

    private final StringRedisTemplate redis;
    private final boolean redisEnabled;

    /** The fallback, and the default. */
    private final Map<String, Entry> memory = new ConcurrentHashMap<>();

    private static final class Entry {
        final String channel;
        final String password;
        final Instant expiresAt;
        final AtomicInteger redemptionsLeft;

        Entry(String channel, String password, Instant expiresAt, int redemptions) {
            this.channel = channel;
            this.password = password;
            this.expiresAt = expiresAt;
            this.redemptionsLeft = new AtomicInteger(redemptions);
        }

        boolean expired() {
            return Instant.now().isAfter(expiresAt);
        }
    }

    public SessionCodeStore(
            Optional<StringRedisTemplate> redis,
            @Value("${session-code.redis-enabled:false}") boolean redisEnabled) {
        this.redis = redis.orElse(null);
        this.redisEnabled = redisEnabled && this.redis != null;
        log.info("[session-code] store: {}", this.redisEnabled ? "redis (shared)" : "memory (this instance only)");
    }

    /** True when codes outlive a restart and are visible to every instance. */
    public boolean isShared() {
        return redisEnabled;
    }

    public void put(String code, String channel, String password, Duration ttl, int redemptions) {
        if (redisEnabled) {
            try {
                // channel and password are joined with a character neither can
                // contain in a URL-safe room name; the count rides along so a
                // redemption is a single write.
                redis.opsForValue().set(KEY_PREFIX + code,
                        redemptions + "\n" + channel + "\n" + password, ttl);
                return;
            } catch (Exception e) {
                log.warn("[session-code] redis unavailable, keeping {} in memory instead: {}", code, e.getMessage());
            }
        }
        memory.put(code, new Entry(channel, password, Instant.now().plus(ttl), redemptions));
    }

    /**
     * Spend one redemption and return the room, or empty if the code is
     * unknown, expired or used up — the caller must not be able to tell which.
     */
    public Optional<Room> redeem(String code) {
        if (redisEnabled) {
            try {
                String raw = redis.opsForValue().get(KEY_PREFIX + code);
                if (raw == null) {
                    return Optional.empty();
                }
                String[] parts = raw.split("\n", 3);
                if (parts.length != 3) {
                    redis.delete(KEY_PREFIX + code);
                    return Optional.empty();
                }
                int left = Integer.parseInt(parts[0]) - 1;
                if (left < 0) {
                    redis.delete(KEY_PREFIX + code);
                    return Optional.empty();
                }
                if (left == 0) {
                    redis.delete(KEY_PREFIX + code);
                } else {
                    // Keep whatever life the key had left; do not extend it.
                    Long ttl = redis.getExpire(KEY_PREFIX + code);
                    redis.opsForValue().set(KEY_PREFIX + code,
                            left + "\n" + parts[1] + "\n" + parts[2],
                            Duration.ofSeconds(ttl != null && ttl > 0 ? ttl : 60));
                }
                return Optional.of(new Room(parts[1], parts[2], left));
            } catch (Exception e) {
                log.warn("[session-code] redis unavailable on redeem, falling back to memory: {}", e.getMessage());
            }
        }

        sweep();
        Entry entry = memory.get(code);
        if (entry == null || entry.expired()) {
            memory.remove(code);
            return Optional.empty();
        }
        int left = entry.redemptionsLeft.decrementAndGet();
        if (left < 0) {
            memory.remove(code);
            return Optional.empty();
        }
        return Optional.of(new Room(entry.channel, entry.password, Math.max(0, left)));
    }

    /** Whether this code is already taken, so mint does not collide. */
    public boolean exists(String code) {
        if (redisEnabled) {
            try {
                return Boolean.TRUE.equals(redis.hasKey(KEY_PREFIX + code));
            } catch (Exception e) {
                // Fall through: a collision is far less costly than a failure.
            }
        }
        Entry entry = memory.get(code);
        return entry != null && !entry.expired();
    }

    /**
     * How many codes this instance is holding in memory. Redis is not counted:
     * its size is not this service's business and the cap exists to stop one
     * process filling its own heap.
     */
    public int liveInMemory() {
        sweep();
        return memory.size();
    }

    private void sweep() {
        memory.entrySet().removeIf(e -> e.getValue().expired());
    }
}
