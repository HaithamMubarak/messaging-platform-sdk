package com.hmdev.messaging.common.filter;

import com.hmdev.messaging.common.data.AgentInfo;
import java.util.List;

/**
 * Logical OR expression
 * Example: role=relay || role=cleanup
 */
public class OrExpression implements FilterExpression {

    private final List<FilterExpression> expressions;

    public OrExpression(List<FilterExpression> expressions) {
        this.expressions = expressions;
    }

    @Override
    public boolean evaluate(AgentInfo agent) {
        for (FilterExpression expr : expressions) {
            if (expr.evaluate(agent)) {
                return true;
            }
        }
        return false;
    }

    @Override
    public String toString() {
        return "OR" + expressions;
    }
}

