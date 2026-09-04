package com.hmdev.messaging.sdk.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * Stable, extension-free public legal URLs.  Google OAuth configuration uses
 * these URLs, so they must not depend on a static-server directory index.
 */
@Controller
public class LegalController {

    @GetMapping({"/privacy", "/privacy/"})
    public String privacy() {
        return "forward:/privacy.html";
    }

    @GetMapping({"/terms", "/terms/"})
    public String terms() {
        return "forward:/terms.html";
    }
}
