package com.hmdev.sdk.local.security.crypto;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.annotation.PostConstruct;
import javax.persistence.AttributeConverter;
import javax.persistence.Converter;

/**
 * Encrypts secret columns on the way to the database and decrypts them on the
 * way back, so a credential is never at rest in the clear.
 *
 * JPA instantiates converters itself, outside the Spring context, so the crypto
 * is held statically and injected once at startup. That is the usual shape for
 * a converter that needs configuration.
 */
@Converter
@Component
@Slf4j
public class EncryptedStringConverter implements AttributeConverter<String, String> {

    private static volatile SecretCrypto crypto;

    @Value("${sls.security.secret-key:${SLS_SECRET_KEY:}}")
    private String configuredKey;

    @Value("${sls.data.directory:./data}")
    private String dataDirectory;

    @PostConstruct
    void init() {
        if (crypto == null) {
            crypto = new SecretCrypto(configuredKey, SecretCrypto.defaultKeyFile(dataDirectory));
        }
    }

    /** For tests, which construct the converter directly. */
    static void useForTesting(SecretCrypto testCrypto) {
        crypto = testCrypto;
    }

    @Override
    public String convertToDatabaseColumn(String attribute) {
        return crypto == null ? attribute : crypto.encrypt(attribute);
    }

    @Override
    public String convertToEntityAttribute(String dbData) {
        return crypto == null ? dbData : crypto.decrypt(dbData);
    }
}
