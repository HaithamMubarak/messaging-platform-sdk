package com.hmdev.messaging.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Collection;
import java.util.Map;

public final class CommonUtils {
    private CommonUtils() { /* no instances */ }

    private static final Logger logger = LoggerFactory.getLogger(CommonUtils.class);

    /**
     * Sleeps for the specified timeout in milliseconds.
     *
     * @param timeout the sleep duration in milliseconds
     * @return true if the sleep was interrupted, false otherwise
     */
    public static boolean sleep(long timeout) {
        boolean interrupted = false;
        try {
            Thread.sleep(timeout);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            logger.warn("Sleep interrupted: {}", e.getMessage());
            interrupted = true;
        }
        return interrupted;
    }

    public static boolean isNotEmpty(Object object) {
        return !isEmpty(object);
    }

    public static boolean isEmpty(Object object) {
        if (object == null) {
            return true;
        }
        if (object instanceof String) {
            return object.toString().isEmpty();
        }
        if (object instanceof Collection) {
            return ((Collection<?>) object).isEmpty();
        }

        if (object instanceof Map) {
            return ((Map<?, ?>) object).isEmpty();
        }
        return false;
    }
}
