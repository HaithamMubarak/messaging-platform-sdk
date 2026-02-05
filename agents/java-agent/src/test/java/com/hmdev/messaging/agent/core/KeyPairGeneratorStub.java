package com.hmdev.messaging.agent.core;

import java.security.KeyPair;
import java.security.PrivateKey;

public final class KeyPairGeneratorStub {

    private static final class DummyPrivateKey implements PrivateKey {
        @Override
        public String getAlgorithm() { return "RSA"; }
        @Override
        public String getFormat() { return "PKCS#8"; }
        @Override
        public byte[] getEncoded() { return new byte[]{0}; }
    }

    public static KeyPair generate() {
        return new KeyPair(null, new DummyPrivateKey());
    }
}
