package com.hmdev.messaging.common.filter;

import java.util.ArrayList;
import java.util.List;

/**
 * Parser for filter expressions
 *
 * Grammar:
 *   expression := orExpr
 *   orExpr     := andExpr ('||' andExpr)*
 *   andExpr    := notExpr ('&&' notExpr)*
 *   notExpr    := '!' primary | primary
 *   primary    := '(' orExpr ')' | condition
 *   condition  := key operator value
 *   operator   := '=' | '!='
 *
 * Examples:
 *   role=webrtc-relay
 *   role=relay || role=cleanup
 *   role=webrtc-relay && status=active
 *   !role=bot
 *   name=admin* || name=master
 *   (role=client || role=relay) && status=active
 *   (role=webrtc-relay || role=cleanup) && status=active && version=2*
 */
public class FilterParser {

    private String input;
    private int pos;

    private FilterParser(String input) {
        this.input = input != null ? input.trim() : "";
        this.pos = 0;
    }

    public static FilterExpression parse(String filter) {
        if (filter == null || filter.trim().isEmpty()) {
            return null;
        }
        FilterParser parser = new FilterParser(filter);
        return parser.parseExpression();
    }

    private FilterExpression parseExpression() {
        return parseOrExpression();
    }

    private FilterExpression parseOrExpression() {
        List<FilterExpression> expressions = new ArrayList<>();
        expressions.add(parseAndExpression());

        while (peek("||")) {
            consume("||");
            expressions.add(parseAndExpression());
        }

        return expressions.size() == 1 ? expressions.get(0) : new OrExpression(expressions);
    }

    private FilterExpression parseAndExpression() {
        List<FilterExpression> expressions = new ArrayList<>();
        expressions.add(parseNotExpression());

        while (peek("&&")) {
            consume("&&");
            expressions.add(parseNotExpression());
        }

        return expressions.size() == 1 ? expressions.get(0) : new AndExpression(expressions);
    }

    private FilterExpression parseNotExpression() {
        skipWhitespace();

        if (peek("!")) {
            consume("!");
            return new NotExpression(parsePrimary());
        }

        return parsePrimary();
    }

    private FilterExpression parsePrimary() {
        skipWhitespace();

        // Handle parentheses for grouping
        if (peek("(")) {
            consume("(");
            FilterExpression expr = parseOrExpression();
            skipWhitespace();
            if (!peek(")")) {
                throw new IllegalArgumentException("Expected ')' at position " + pos);
            }
            consume(")");
            return expr;
        }

        return parseCondition();
    }

    private FilterExpression parseCondition() {
        skipWhitespace();

        // Parse key
        String key = parseIdentifier();
        if (key == null) {
            throw new IllegalArgumentException("Expected identifier at position " + pos);
        }

        skipWhitespace();

        // Parse operator
        String operator;
        if (peek("!=")) {
            operator = "!=";
            consume("!=");
        } else if (peek("=")) {
            operator = "=";
            consume("=");
        } else {
            throw new IllegalArgumentException("Expected operator (= or !=) at position " + pos);
        }

        skipWhitespace();

        // Parse value
        String value = parseValue();
        if (value == null) {
            throw new IllegalArgumentException("Expected value at position " + pos);
        }

        return new ConditionExpression(key, operator, value);
    }

    private String parseIdentifier() {
        skipWhitespace();
        int start = pos;

        while (pos < input.length()) {
            char c = input.charAt(pos);
            if (Character.isLetterOrDigit(c) || c == '_' || c == '-' || c == '.') {
                pos++;
            } else {
                break;
            }
        }

        return pos > start ? input.substring(start, pos) : null;
    }

    private String parseValue() {
        skipWhitespace();
        int start = pos;

        while (pos < input.length()) {
            char c = input.charAt(pos);
            // Value ends at operator or whitespace before operator
            if (c == '&' || c == '|' || c == '!' || c == ')') {
                break;
            }
            // Allow wildcard
            if (Character.isLetterOrDigit(c) || c == '_' || c == '-' || c == '.' || c == '*') {
                pos++;
            } else if (Character.isWhitespace(c)) {
                // Check if next non-whitespace is operator
                int saved = pos;
                skipWhitespace();
                if (pos >= input.length() || input.charAt(pos) == '&' ||
                    input.charAt(pos) == '|' || input.charAt(pos) == '!') {
                    pos = saved; // Restore position, end of value
                    break;
                }
                pos = saved;
                pos++;
            } else {
                break;
            }
        }

        String value = start < pos ? input.substring(start, pos).trim() : null;
        return value != null && !value.isEmpty() ? value : null;
    }

    private void skipWhitespace() {
        while (pos < input.length() && Character.isWhitespace(input.charAt(pos))) {
            pos++;
        }
    }

    private boolean peek(String str) {
        skipWhitespace();
        return input.startsWith(str, pos);
    }

    private void consume(String str) {
        skipWhitespace();
        if (!input.startsWith(str, pos)) {
            throw new IllegalArgumentException("Expected '" + str + "' at position " + pos);
        }
        pos += str.length();
    }
}

