package com.hmdev.messaging.common.filter;

import com.hmdev.messaging.common.data.AgentInfo;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class FilterParserTest {

    @Test
    void testSimpleRoleFilter() {
        AgentInfo agent = createAgent("relay-1", "webrtc-relay");

        FilterExpression filter = FilterParser.parse("role=webrtc-relay");
        assertTrue(filter.evaluate(agent));

        FilterExpression filter2 = FilterParser.parse("role=client");
        assertFalse(filter2.evaluate(agent));
    }

    @Test
    void testOrExpression() {
        AgentInfo agent = createAgent("relay-1", "webrtc-relay");

        FilterExpression filter = FilterParser.parse("role=webrtc-relay || role=client");
        assertTrue(filter.evaluate(agent));

        AgentInfo agent2 = createAgent("user-1", "client");
        assertTrue(filter.evaluate(agent2));

        AgentInfo agent3 = createAgent("bot-1", "bot");
        assertFalse(filter.evaluate(agent3));
    }

    @Test
    void testNotExpression() {
        AgentInfo agent = createAgent("user-1", "client");

        FilterExpression filter = FilterParser.parse("!role=bot");
        assertTrue(filter.evaluate(agent));

        AgentInfo bot = createAgent("bot-1", "bot");
        assertFalse(filter.evaluate(bot));
    }

    @Test
    void testWildcardMatching() {
        AgentInfo agent = createAgent("admin-master", null);

        // Prefix wildcard
        FilterExpression filter1 = FilterParser.parse("name=admin*");
        assertTrue(filter1.evaluate(agent));

        // Suffix wildcard
        FilterExpression filter2 = FilterParser.parse("name=*master");
        assertTrue(filter2.evaluate(agent));

        // Contains wildcard
        FilterExpression filter3 = FilterParser.parse("name=*min-mas*");
        assertTrue(filter3.evaluate(agent));
    }

    @Test
    void testTagMatching() {
        AgentInfo agent = createAgent("user-1", "client");
        // Store tags as comma-separated string in metadata
        Map<String, String> metadata = new HashMap<>();
        metadata.put("tags", "premium,video");
        // Use the full constructor and supply null for optional fields customEventType and restrictedCapabilities
        agent = new AgentInfo(agent.getAgentName(), agent.getAgentType(), agent.getDescriptor(),
                              agent.getIpAddress(), metadata, agent.getRole(), null, null);

        FilterExpression filter1 = FilterParser.parse("tags=*premium*");
        assertTrue(filter1.evaluate(agent));

        FilterExpression filter2 = FilterParser.parse("tags=*basic*");
        assertFalse(filter2.evaluate(agent));
    }

    @Test
    void testComplexExpression() {
        AgentInfo agent = createAgent("relay-1", "webrtc-relay");
        Map<String, String> metadata = new HashMap<>();
        metadata.put("status", "active");
        metadata.put("version", "2.1.0");
        // Use full constructor with nulls for customEventType and restrictedCapabilities
        agent = new AgentInfo(agent.getAgentName(), agent.getAgentType(), agent.getDescriptor(),
                              agent.getIpAddress(), metadata, agent.getRole(), null, null);

        FilterExpression filter = FilterParser.parse(
            "(role=webrtc-relay || role=cleanup) && status=active"
        );
        assertTrue(filter.evaluate(agent));

        // Test with version wildcard separately
        FilterExpression filter2 = FilterParser.parse("version=2*");
        assertTrue(filter2.evaluate(agent));
    }

    @Test
    void testNotEquals() {
        AgentInfo agent = createAgent("user-1", "client");

        FilterExpression filter = FilterParser.parse("role!=bot");
        assertTrue(filter.evaluate(agent));

        AgentInfo bot = createAgent("bot-1", "bot");
        assertFalse(filter.evaluate(bot));
    }

    @Test
    void testInvalidFilter() {
        assertThrows(IllegalArgumentException.class, () -> {
            FilterParser.parse("role=");
        });

        assertThrows(IllegalArgumentException.class, () -> {
            FilterParser.parse("=value");
        });
    }

    private AgentInfo createAgent(String name, String role) {
        AgentInfo agent = new AgentInfo();
        agent.setAgentName(name);
        agent.setRole(role);
        return agent;
    }
}

