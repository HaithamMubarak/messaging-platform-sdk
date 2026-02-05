package com.hmdev.messaging.common.filter;

import com.hmdev.messaging.common.data.AgentInfo;

/**
 * Base interface for filter expressions
 */
public interface FilterExpression {
    /**
     * Evaluate this filter against an agent
     * @param agent The agent info to test
     * @return true if agent matches the filter
     */
    boolean evaluate(AgentInfo agent);
}

