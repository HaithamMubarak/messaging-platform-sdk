package com.hmdev.messaging.agent.core;

import com.hmdev.messaging.common.data.EventMessage;
import com.hmdev.messaging.common.data.EventMessageResult;
import com.hmdev.messaging.common.data.ReceiveConfig;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

public class RunnableReceive implements Runnable {

    private final AgentConnection channel;
    private final AgentConnectionEventHandler messageHandler;

    @Getter
    @Setter
    private ReceiveConfig receiveConfig;

    public RunnableReceive(AgentConnection channel, AgentConnectionEventHandler messageHandler,
                           ReceiveConfig initialReceiveConfig) {
        this.channel = channel;
        this.messageHandler = messageHandler;
        this.receiveConfig = new ReceiveConfig(initialReceiveConfig);
    }

    @Override
    public void run() {
        while (channel.isReady()) {
            EventMessageResult messageEventResult = channel.receive(receiveConfig);
            if (messageEventResult != null) {

                List<EventMessage> events = messageEventResult.getEvents();
                List<EventMessage> ephemeralEvents = messageEventResult.getEphemeralEvents();

                // Deliver ephemeral events first (they are time-sensitive)
                if (ephemeralEvents != null && !ephemeralEvents.isEmpty()) {
                    messageHandler.onMessageEvents(ephemeralEvents);
                }

                // Deliver normal events batch to caller handler
                if (events != null && !events.isEmpty()) {
                    messageHandler.onMessageEvents(events);
                    this.receiveConfig.updateOffsets(messageEventResult);
                }
            }
        }
    }
}
