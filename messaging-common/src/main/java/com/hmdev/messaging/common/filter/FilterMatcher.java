package com.hmdev.messaging.common.filter;

import com.hmdev.messaging.common.data.AgentInfo;
import com.hmdev.messaging.common.data.EventMessage;

/**
 * Utility class for matching messages to agents using filters
 */
public class FilterMatcher {

    /**
     * Check if a message should be delivered to an agent
     *
     * @param message The message to deliver
     * @param agent The agent to check
     * @return true if message should be delivered to this agent
     */
    public static boolean matches(EventMessage message, AgentInfo agent) {
        // Don't send to sender
        if (message.getFrom() != null && message.getFrom().equals(agent.getAgentName())) {
            return false;
        }

        // Legacy support: 'to' field takes precedence
        if (message.getTo() != null && !message.getTo().isEmpty()) {
            return message.getTo().equals(agent.getAgentName());
        }

        // If no filter, broadcast to all (except sender)
        if (message.getFilter() == null || message.getFilter().isEmpty()) {
            return true;
        }

        // Parse and evaluate filter
        try {
            FilterExpression filter = FilterParser.parse(message.getFilter());
            if (filter == null) {
                return true; // Empty filter = broadcast
            }
            return filter.evaluate(agent);
        } catch (Exception e) {
            // Invalid filter - log and treat as broadcast
            System.err.println("Invalid filter: " + message.getFilter() + " - " + e.getMessage());
            return true;
        }
    }

    /**
     * Validate filter syntax
     *
     * @param filterString The filter to validate
     * @return null if valid, error message if invalid
     */
    public static String validateFilter(String filterString) {
        if (filterString == null || filterString.trim().isEmpty()) {
            return null; // Empty is valid (broadcast)
        }

        try {
            FilterParser.parse(filterString);
            return null; // Valid
        } catch (Exception e) {
            return e.getMessage();
        }
    }
}

