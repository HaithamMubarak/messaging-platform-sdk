package com.hmdev.sdk.local.terminal;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * What a terminal stream ticket must and must not allow.
 *
 * The socket was previously guarded by the terminal session id in the URL —
 * which is not a secret, since it appears in browser history, proxy logs and
 * Referer headers, and is long-lived. Each property below is one of the ways a
 * ticket differs from that.
 */
class TerminalTicketServiceTest {

    private TerminalTicketService tickets;

    @BeforeEach
    void setUp() {
        tickets = new TerminalTicketService();
    }

    @Test
    @DisplayName("a freshly issued ticket opens its own session")
    void happyPath() {
        String t = tickets.issue("sess-1");
        assertThat(tickets.redeem(t, "sess-1")).isTrue();
    }

    @Test
    @DisplayName("a ticket cannot be spent twice")
    void singleUse() {
        String t = tickets.issue("sess-1");
        assertThat(tickets.redeem(t, "sess-1")).isTrue();
        assertThat(tickets.redeem(t, "sess-1"))
                .as("replaying a captured stream URL must fail")
                .isFalse();
    }

    @Test
    @DisplayName("a ticket is bound to one session")
    void audienceIsEnforced() {
        String t = tickets.issue("sess-1");
        assertThat(tickets.redeem(t, "sess-2"))
                .as("a ticket for my shell must not open yours")
                .isFalse();
    }

    @Test
    @DisplayName("a wrong guess burns the ticket rather than allowing retries")
    void failedRedeemConsumes() {
        String t = tickets.issue("sess-1");
        tickets.redeem(t, "wrong-session");
        assertThat(tickets.redeem(t, "sess-1"))
                .as("a ticket tried against the wrong session is spent")
                .isFalse();
    }

    @Test
    @DisplayName("an unknown or absent ticket is refused")
    void unknownTicketsRefused() {
        assertThat(tickets.redeem("not-a-ticket", "sess-1")).isFalse();
        assertThat(tickets.redeem(null, "sess-1")).isFalse();
        assertThat(tickets.redeem(tickets.issue("sess-1"), null)).isFalse();
    }

    @Test
    @DisplayName("an expired ticket is refused")
    @SuppressWarnings("unchecked")
    void expiryIsEnforced() throws Exception {
        String t = tickets.issue("sess-1");

        // Age the ticket rather than sleeping out its lifetime.
        Field f = TerminalTicketService.class.getDeclaredField("issued");
        f.setAccessible(true);
        Map<String, Object> issued = (Map<String, Object>) f.get(tickets);
        Object entry = issued.get(t);
        Field exp = entry.getClass().getDeclaredField("expiresAt");
        exp.setAccessible(true);
        exp.set(entry, Instant.now().minusSeconds(1));

        assertThat(tickets.redeem(t, "sess-1")).isFalse();
    }

    @Test
    @DisplayName("tickets are unguessable and never repeat")
    void ticketsAreRandom() {
        String a = tickets.issue("sess-1");
        String b = tickets.issue("sess-1");
        assertThat(a).isNotEqualTo(b);
        // 32 random bytes, base64url without padding.
        assertThat(a.length()).isGreaterThanOrEqualTo(43);
    }

    @Test
    @DisplayName("a ticket must name a session")
    void sessionIsRequired() {
        assertThatThrownBy(() -> tickets.issue(null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> tickets.issue("")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("unspent tickets do not accumulate for ever")
    void expiredTicketsArePurged() throws Exception {
        for (int i = 0; i < 5; i++) {
            tickets.issue("sess-" + i);
        }
        assertThat(tickets.outstanding()).isEqualTo(5);

        Field f = TerminalTicketService.class.getDeclaredField("issued");
        f.setAccessible(true);
        @SuppressWarnings("unchecked")
        Map<String, Object> issued = (Map<String, Object>) f.get(tickets);
        for (Object entry : issued.values()) {
            Field exp = entry.getClass().getDeclaredField("expiresAt");
            exp.setAccessible(true);
            exp.set(entry, Instant.now().minusSeconds(1));
        }
        assertThat(tickets.outstanding()).isZero();
    }
}
