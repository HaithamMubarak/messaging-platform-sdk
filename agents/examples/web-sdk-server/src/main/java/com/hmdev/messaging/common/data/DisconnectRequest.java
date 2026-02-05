package com.hmdev.messaging.common.data;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
@EqualsAndHashCode(callSuper = true)
public class DisconnectRequest extends SessionRequest {
    private Boolean asyncDisconnect = false;
}

