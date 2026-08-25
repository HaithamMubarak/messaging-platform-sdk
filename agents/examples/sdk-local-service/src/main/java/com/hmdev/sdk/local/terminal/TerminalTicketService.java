package com.hmdev.sdk.local.terminal;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Short-lived, single-purpose tickets for opening a terminal WebSocket.
 *
 * The socket used to be guarded by nothing but the terminal session id sitting
 * in the URL path. A URL is not a secret: it lands in browser history, proxy
 * and access logs, and Referer headers — and the same id is long-lived and
 * appears in ordinary REST calls, so anyone who saw it once could attach to a
 * live shell.
 *
 * A ticket is different in every way that matters: it is issued only to an
 * already-authenticated caller, it is bound to ONE terminal session (the
 * audience), it expires in seconds rather than hours, and it is burned on
 * first use, so replaying a captured URL fails.
 *
 * Tickets are held in memory on purpose. This is a per-machine local helper,
 * and a restart invalidating outstanding tickets is the correct behaviour.
 */
@Service
@Slf4j
public class TerminalTicketService {

    /** Long enough to open a socket, short enough that a leaked URL is stale. */
    private static final Duration TICKET_TTL = Duration.ofSeconds(30);

    private static final int TICKET_BYTES = 32;

    private final SecureRandom secureRandom = new SecureRandom();

    /** ticket -> what it is good for. Entries are removed on use or expiry. */
    private final Map<String, Ticket> issued = new ConcurrentHashMap<>();

    private static final class Ticket {
        final String sessionId;
        final Instant expiresAt;

        Ticket(String sessionId, Instant expiresAt) {
            this.sessionId = sessionId;
            this.expiresAt = expiresAt;
        }
    }

    /**
     * Issue a ticket that opens exactly one WebSocket for one terminal session.
     */
    public String issue(String sessionId) {
        if (sessionId == null || sessionId.isEmpty()) {
            throw new IllegalArgumentException("A ticket must name the session it is for");
        }
        purgeExpired();

        byte[] raw = new byte[TICKET_BYTES];
        secureRandom.nextBytes(raw);
        String ticket = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);

        issued.put(ticket, new Ticket(sessionId, Instant.now().plus(TICKET_TTL)));
        // Deliberately not logged: a ticket in a log file is a usable credential
        // for its lifetime.
        log.debug("[Terminal] Issued a stream ticket for session {}", sessionId);
        return ticket;
    }

    /**
     * Spend a ticket. Returns true only if it exists, is unexpired, and was
     * issued for this exact session — and it cannot be spent twice.
     */
    public boolean redeem(String ticket, String sessionId) {
        if (ticket == null || sessionId == null) {
            return false;
        }
        // Remove first: even a failed match burns the ticket, so a wrong guess
        // cannot be retried against a different session.
        Ticket found = issued.remove(ticket);
        if (found == null) {
            return false;
        }
        if (Instant.now().isAfter(found.expiresAt)) {
            log.debug("[Terminal] Rejected an expired stream ticket");
            return false;
        }
        // Constant-time comparison: the audience check should not leak the
        // session id it was issued for through timing.
        boolean audienceMatches = MessageDigest.isEqual(
                found.sessionId.getBytes(StandardCharsets.UTF_8),
                sessionId.getBytes(StandardCharsets.UTF_8));
        if (!audienceMatches) {
            log.warn("[Terminal] Rejected a stream ticket presented for the wrong session");
        }
        return audienceMatches;
    }

    /** Drop tickets nobody spent, so the map cannot grow without bound. */
    public void purgeExpired() {
        Instant now = Instant.now();
        issued.entrySet().removeIf(e -> now.isAfter(e.getValue().expiresAt));
    }

    /** Outstanding unspent tickets — for tests and diagnostics. */
    public int outstanding() {
        purgeExpired();
        return issued.size();
    }
}
