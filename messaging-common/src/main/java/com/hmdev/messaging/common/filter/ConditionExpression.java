package com.hmdev.messaging.common.filter;

import com.hmdev.messaging.common.data.AgentInfo;

/**
 * Condition expression: key operator value
 * Examples: role=webrtc-relay, name=admin*, tag=premium
 */
public class ConditionExpression implements FilterExpression {

    private final String key;
    private final String operator;
    private final String value;

    public ConditionExpression(String key, String operator, String value) {
        this.key = key;
        this.operator = operator;
        this.value = value;
    }

    @Override
    public boolean evaluate(AgentInfo agent) {
        // agent.get() already handles name, role, and metadata lookups
        String agentValue = agent.get(key);

        if (agentValue == null) {
            return "!=".equals(operator); // null != value is true
        }

        return evaluateOperator(agentValue, operator, value);
    }


    private boolean evaluateOperator(String agentValue, String operator, String filterValue) {
        switch (operator) {
            case "=":
                return matchValue(agentValue, filterValue);
            case "!=":
            case "!":
                return !matchValue(agentValue, filterValue);
            default:
                return false;
        }
    }

    /**
     * Match value with wildcard support
     * Supports: exact match, prefix (*suffix), suffix (prefix*), contains (*middle*)
     */
    private boolean matchValue(String agentValue, String filterValue) {
        if (agentValue == null) {
            return false;
        }

        // Exact match
        if (!filterValue.contains("*")) {
            return agentValue.equals(filterValue);
        }

        // Wildcard matching
        if (filterValue.equals("*")) {
            return true; // Match anything
        }

        if (filterValue.startsWith("*") && filterValue.endsWith("*")) {
            // *middle* - contains
            String middle = filterValue.substring(1, filterValue.length() - 1);
            return agentValue.contains(middle);
        }

        if (filterValue.startsWith("*")) {
            // *suffix - ends with
            String suffix = filterValue.substring(1);
            return agentValue.endsWith(suffix);
        }

        if (filterValue.endsWith("*")) {
            // prefix* - starts with
            String prefix = filterValue.substring(0, filterValue.length() - 1);
            return agentValue.startsWith(prefix);
        }

        // Multiple wildcards - convert to regex
        String regex = filterValue.replace("*", ".*");
        return agentValue.matches(regex);
    }

    @Override
    public String toString() {
        return key + operator + value;
    }
}

