package com.hmdev.messaging.common.filter;

import com.hmdev.messaging.common.data.AgentInfo;
import java.util.List;

/**
 * Logical AND expression
 * Example: role=webrtc-relay && status=active
 */
public class AndExpression implements FilterExpression {

    private final List<FilterExpression> expressions;

    public AndExpression(List<FilterExpression> expressions) {
        this.expressions = expressions;
    }

    @Override
    public boolean evaluate(AgentInfo agent) {
        for (FilterExpression expr : expressions) {
            if (!expr.evaluate(agent)) {
                return false;
            }
        }
        return true;
    }

    @Override
    public String toString() {
        return "AND" + expressions;
    }
}

