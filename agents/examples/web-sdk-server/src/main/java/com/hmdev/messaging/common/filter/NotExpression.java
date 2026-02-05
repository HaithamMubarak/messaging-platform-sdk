package com.hmdev.messaging.common.filter;

import com.hmdev.messaging.common.data.AgentInfo;

/**
 * Negation expression
 * Example: !role=bot
 */
public class NotExpression implements FilterExpression {

    private final FilterExpression expression;

    public NotExpression(FilterExpression expression) {
        this.expression = expression;
    }

    @Override
    public boolean evaluate(AgentInfo agent) {
        return !expression.evaluate(agent);
    }

    @Override
    public String toString() {
        return "NOT(" + expression + ")";
    }
}

